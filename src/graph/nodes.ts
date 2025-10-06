import { ChatAnthropic } from '@langchain/anthropic';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Tool } from '@langchain/core/tools';
import { Octokit } from '@octokit/rest';
import { GraphStateType } from './state.js';
import {
  GitHubCommitListenerTool,
  GitHubCommitDiffTool,
  CommitData,
  CommitDiffData,
} from '../tools/githubTools.js';
import { JiraTicketExtractorTool, JiraTicketData } from '../tools/jiraTools.js';
import {
  GitCloneTool,
  CodebaseSearchTool,
  CodebaseFileTool,
  CodebaseStructureTool,
} from '../tools/codebaseTools.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface NodeConfig {
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
  githubTestOwner?: string;
  jiraHost: string;
  jiraEmail: string;
  jiraApiToken: string;
  anthropicApiKey: string;
}

export function createNodes(config: NodeConfig) {
  // Initialize tools
  const githubCommitListener = new GitHubCommitListenerTool({
    token: config.githubToken,
    owner: config.githubOwner,
    repo: config.githubRepo,
  });

  const githubCommitDiff = new GitHubCommitDiffTool({
    token: config.githubToken,
    owner: config.githubOwner,
    repo: config.githubRepo,
  });

  const jiraTicketExtractor = new JiraTicketExtractorTool({
    host: config.jiraHost,
    email: config.jiraEmail,
    apiToken: config.jiraApiToken,
  });

  const llm = new ChatAnthropic({
    modelName: 'claude-3-5-sonnet-20241022',
    temperature: 0,
    anthropicApiKey: config.anthropicApiKey,
  });

  // Node 1: Fetch latest commit from GitHub
  async function fetchCommitNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('📡 Step 1: Fetching latest commit from GitHub...');
    try {
      const commitDataRaw = await githubCommitListener._call();
      const commitData: CommitData = JSON.parse(commitDataRaw);

      console.log(`✅ Found commit: ${commitData.hash.substring(0, 7)}`);
      console.log(`   Message: ${commitData.message}`);
      console.log(`   Author: ${commitData.author}\n`);

      return { commitData };
    } catch (error) {
      const errorMsg = `Failed to fetch commit: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 2: Retrieve commit diff
  async function fetchDiffNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('📄 Step 2: Retrieving commit diff...');

    if (!state.commitData) {
      return { error: 'No commit data available' };
    }

    try {
      const diffDataRaw = await githubCommitDiff._call(state.commitData.hash);
      const diffData: CommitDiffData = JSON.parse(diffDataRaw);

      console.log(`✅ Retrieved diff for ${diffData.filesChanged.length} file(s)`);
      diffData.filesChanged.forEach((file) => {
        console.log(`   - ${file.filename} (+${file.additions}/-${file.deletions})`);
      });
      console.log();

      return { diffData };
    } catch (error) {
      const errorMsg = `Failed to fetch diff: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 3: Extract Jira ticket information
  async function extractJiraNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('🎫 Step 3: Extracting Jira ticket information...');

    if (!state.commitData) {
      return { error: 'No commit data available' };
    }

    try {
      const jiraDataRaw = await jiraTicketExtractor._call(state.commitData.message);
      const jiraData: JiraTicketData = JSON.parse(jiraDataRaw);

      if (jiraData.found) {
        console.log(`✅ Found Jira ticket: ${jiraData.ticketNumber}`);
        console.log(`   Summary: ${jiraData.summary}`);
        console.log(`   Description: ${jiraData.description}`);
        console.log(`   Status: ${jiraData.status}`);
        console.log(`   Type: ${jiraData.issueType}\n`);
      } else {
        console.log(`⚠️  ${jiraData.message}\n`);
      }

      return { jiraData };
    } catch (error) {
      const errorMsg = `Failed to extract Jira info: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 4: Clone codebase for analysis
  async function cloneCodebaseNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('📦 Step 4: Cloning codebase for analysis...');

    if (!state.commitData) {
      return { error: 'No commit data available' };
    }

    try {
      // Use base branch from environment or default to main
      const branchName = process.env.BASE_BRANCH || 'main';
      const targetDir = path.join(process.cwd(), 'temp', 'codebase');

      const gitCloneTool = new GitCloneTool({
        token: config.githubToken,
        owner: config.githubOwner,
        repo: config.githubRepo,
        branch: branchName,
        targetDir,
      });

      const result = await gitCloneTool._call();
      const cloneResult = JSON.parse(result);

      console.log(`✅ Codebase cloned to: ${cloneResult.path}`);
      console.log(`   Branch: ${cloneResult.branch}\n`);

      return {
        codebasePath: cloneResult.path,
        branchName: cloneResult.branch,
      };
    } catch (error) {
      const errorMsg = `Failed to clone codebase: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 5: Generate AI summary with codebase analysis
  async function generateSummaryNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('🤖 Step 5: Generating AI summary with codebase analysis...\n');

    if (!state.commitData || !state.diffData || !state.codebasePath) {
      return { error: 'Missing required data for summary generation' };
    }

    try {
      // Create codebase analysis tools
      const codebaseSearch = new CodebaseSearchTool(state.codebasePath);
      const codebaseFile = new CodebaseFileTool(state.codebasePath);
      const codebaseStructure = new CodebaseStructureTool(state.codebasePath);

      const tools = [codebaseSearch, codebaseFile, codebaseStructure];

      // Create agent prompt
      const agentPrompt = ChatPromptTemplate.fromMessages([
        ['system', 'You are a code review assistant with access to the full codebase. Analyze the commit information and provide a comprehensive summary.'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}'],
      ]);

      // Create agent
      const agent = await createToolCallingAgent({
        llm,
        tools,
        prompt: agentPrompt,
      });

      const agentExecutor = new AgentExecutor({
        agent,
        tools,
        verbose: false,
      });

      const analysisPrompt = `Analyze the following commit information and provide a comprehensive summary.

COMMIT INFORMATION:
- Hash: ${state.commitData.hash}
- Author: ${state.commitData.author}
- Date: ${state.commitData.date}
- Message: ${state.commitData.message}

FILES CHANGED:
${state.diffData.filesChanged.map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n')}

COMMIT DIFF:
${state.diffData.diff.substring(0, 5000)}${state.diffData.diff.length > 5000 ? '\n... (truncated)' : ''}

${
  state.jiraData?.found
    ? `JIRA TICKET (${state.jiraData.ticketNumber}):
- Summary: ${state.jiraData.summary}
- Description: ${state.jiraData.description}
- Status: ${state.jiraData.status}
- Type: ${state.jiraData.issueType}
- Priority: ${state.jiraData.priority || 'N/A'}
- Assignee: ${state.jiraData.assignee || 'N/A'}
`
    : 'JIRA TICKET: Not found in commit message'
}

CODEBASE ACCESS:
You have access to the full codebase at: ${state.codebasePath}

Available tools for deeper analysis:
- codebase-search: Search for code patterns or keywords across the entire codebase
- codebase-file-read: Read specific files to understand context
- codebase-structure: View directory structure

Please provide a concise summary (2-3 sentences) describing:
- What was changed in this commit
- The purpose of the changes based on the commit message and Jira ticket
- Any notable technical details or impacts

Keep the response brief and suitable for a changelog entry.`;

      const response = await agentExecutor.invoke({
        input: analysisPrompt,
      });

      console.log('═══════════════════════════════════════════════════════════════');
      console.log('                    📋 COMMIT ANALYSIS SUMMARY');
      console.log('═══════════════════════════════════════════════════════════════\n');
      console.log(response.output);
      console.log('\n═══════════════════════════════════════════════════════════════\n');

      // Ensure summary is a string
      const summary = typeof response.output === 'string'
        ? response.output
        : JSON.stringify(response.output);

      return { summary };
    } catch (error) {
      const errorMsg = `Failed to generate summary: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 6: Update changelog
  async function updateChangelogNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('📝 Step 6: Updating CHANGELOG.md...');

    if (!state.commitData || !state.diffData || !state.summary || !state.codebasePath) {
      return { error: 'Missing required data for changelog update' };
    }

    try {
      const changelogPath = path.join(state.codebasePath, 'CHANGELOG.md');

      // Create changelog entry
      const date = new Date(state.commitData.date).toISOString().split('T')[0];
      const ticketInfo = state.jiraData?.found
        ? `[${state.jiraData.ticketNumber}](${config.jiraHost}/browse/${state.jiraData.ticketNumber})`
        : 'No ticket';
      const ticketType = state.jiraData?.issueType || 'N/A';
      const commitLink = `[${state.commitData.hash.substring(0, 7)}](${state.commitData.url})`;

      // Ensure summary is a string
      const summaryText = typeof state.summary === 'string' ? state.summary : String(state.summary || 'No summary available');

      // Extract concise description from summary (find bullets after "Summary of changes")
      const summaryLines = summaryText.split('\n').filter(line => line.trim());
      let conciseDescription = 'No description';

      for (let i = 0; i < summaryLines.length; i++) {
        if (summaryLines[i].match(/^1\.\s*Summary/i)) {
          // Found the summary section, get bullet points until next numbered section
          const bullets = [];
          for (let j = i + 1; j < summaryLines.length; j++) {
            const line = summaryLines[j].trim();
            if (line.match(/^2\.\s*/)) break; // Stop at next section
            if (line.startsWith('-')) {
              bullets.push(line.substring(1).trim());
            }
          }
          conciseDescription = bullets.length > 0 ? bullets.join(' ') : summaryLines[i + 1] || 'No description';
          break;
        }
      }

      if (conciseDescription === 'No description' && summaryLines.length > 0) {
        conciseDescription = summaryLines[0];
      }

      const changelogEntry = `
## ${date} - ${ticketInfo} (${ticketType})

**Commit:** ${commitLink}

**Summary:**
${summaryText}

---
`;

      // Read existing changelog or create new one
      let existingContent = '';
      try {
        existingContent = await fs.readFile(changelogPath, 'utf-8');
      } catch (error) {
        // File doesn't exist, create header
        existingContent = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n---\n';
      }

      // Prepend new entry to changelog
      const updatedContent = existingContent.replace(
        /---\n/,
        `---\n${changelogEntry}`
      );

      await fs.writeFile(changelogPath, updatedContent, 'utf-8');

      console.log(`✅ Changelog updated at: ${changelogPath}\n`);

      return { changelogUpdated: true };
    } catch (error) {
      const errorMsg = `Failed to update changelog: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 7: Create feature branch
  async function createBranchNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('🌿 Step 7: Creating feature branch...');

    if (!state.codebasePath || !state.commitData) {
      return { error: 'Missing required data for branch creation' };
    }

    try {
      const ticketNumber = state.jiraData?.ticketNumber || 'no-ticket';

      // Extract prefix and create identifier
      // Example: "CIL-692" → prefix: "cil", identifier: "CIL-692"
      const parts = ticketNumber.split('-');
      const prefix = parts[0].toLowerCase();
      const branchName = `${prefix}/${ticketNumber}_change-log-updates`;

      // Get base branch from environment
      const baseBranch = process.env.BASE_BRANCH || 'main';

      // Force checkout base branch, pull latest, then create/checkout feature branch
      await execAsync(`cd "${state.codebasePath}" && git checkout -f ${baseBranch} && git pull origin ${baseBranch}`);

      // Delete local branch if it exists (to avoid conflicts with case-sensitive names)
      try {
        await execAsync(`cd "${state.codebasePath}" && git branch -D ${branchName} 2>/dev/null || true`);
      } catch (error) {
        // Ignore if branch doesn't exist
      }

      // Create new branch
      await execAsync(`cd "${state.codebasePath}" && git checkout -b ${branchName}`);

      console.log(`✅ Created branch: ${branchName}\n`);

      return { featureBranch: branchName };
    } catch (error) {
      const errorMsg = `Failed to create branch: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 8: Commit changelog changes
  async function commitChangelogNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('💾 Step 8: Committing CHANGELOG.md...');

    if (!state.codebasePath || !state.featureBranch) {
      return { error: 'Missing required data for commit' };
    }

    try {
      const ticketNumber = state.jiraData?.ticketNumber || 'Update';
      const commitMessage = `${ticketNumber} update change log`;

      // Stage and commit changelog
      await execAsync(`cd "${state.codebasePath}" && git add CHANGELOG.md && git commit -m "${commitMessage}"`);

      console.log(`✅ Committed changes with message: "${commitMessage}"\n`);

      return { commitCreated: true };
    } catch (error) {
      const errorMsg = `Failed to commit changes: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 9: Create pull request
  async function createPRNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('🔀 Step 9: Creating pull request...');

    if (!state.codebasePath || !state.featureBranch || !state.commitData) {
      return { error: 'Missing required data for PR creation' };
    }

    try {
      const ticketNumber = state.jiraData?.ticketNumber || 'Update';
      const ticketLink = state.jiraData?.found
        ? `\n\nJira: ${config.jiraHost}/browse/${state.jiraData.ticketNumber}`
        : '';

      // Ensure origin remote exists, recreate if necessary
      try {
        await execAsync(`cd "${state.codebasePath}" && git remote get-url origin`);
      } catch (error) {
        // Origin doesn't exist, recreate it
        const remoteUrl = `https://${config.githubToken}@github.com/${config.githubOwner}/${config.githubRepo}.git`;
        await execAsync(`cd "${state.codebasePath}" && git remote add origin ${remoteUrl}`);
      }

      // Push branch to remote (force push since we recreate the branch from base each time)
      await execAsync(`cd "${state.codebasePath}" && git push -u origin ${state.featureBranch} --force`);

      // Create PR using GitHub REST API
      const prTitle = `${ticketNumber} update change log`;
      const prBody = `Automated CHANGELOG update for commit ${state.commitData.hash.substring(0, 7)}${ticketLink}\n\n**Summary:**\n${state.summary?.split('\n').slice(0, 5).join('\n')}`;

      const octokit = new Octokit({ auth: config.githubToken });

      // Get base branch from environment or default to main
      const baseBranch = process.env.BASE_BRANCH || 'main';

      const { data: pr } = await octokit.pulls.create({
        owner: config.githubOwner,
        repo: config.githubRepo,
        title: prTitle,
        body: prBody,
        head: state.featureBranch,
        base: baseBranch,
      });

      console.log(`✅ Pull request created: ${pr.html_url}\n`);

      return { pullRequestUrl: pr.html_url };
    } catch (error) {
      const errorMsg = `Failed to create PR: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 10: Detect endpoint changes
  async function detectEndpointChangesNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('🔍 Step 10: Detecting endpoint changes...');

    // Check if FORCE_API_CHANGED flag is set
    if (process.env.FORCE_API_CHANGED === 'true') {
      console.log('✅ FORCE_API_CHANGED flag is set - forcing endpoint changes to true\n');
      return { endpointChanges: true };
    }

    if (!state.commitData || !state.diffData || !state.codebasePath) {
      return { endpointChanges: false };
    }

    try {
      const llm = new ChatAnthropic({
        modelName: 'claude-3-5-sonnet-20241022',
        temperature: 0,
        anthropicApiKey: config.anthropicApiKey,
      });

      const prompt = `Analyze the following commit diff and determine if there are any API endpoint changes.

COMMIT DIFF:
${state.diffData.diff}

Look for:
- New API routes or endpoints (e.g., app.get(), app.post(), router.get(), @GetMapping, etc.)
- Modified API routes or endpoints
- Deleted API routes or endpoints
- Changes to endpoint paths, parameters, or HTTP methods

Respond with ONLY "YES" if endpoint changes are detected, or "NO" if no endpoint changes are found.`;

      const response = await llm.invoke(prompt);
      const hasEndpointChanges = response.content.toString().trim().toUpperCase() === 'YES';

      console.log(`✅ Endpoint changes detected: ${hasEndpointChanges}\n`);

      return { endpointChanges: hasEndpointChanges };
    } catch (error) {
      console.error(`❌ Failed to detect endpoint changes: ${(error as Error).message}\n`);
      return { endpointChanges: false };
    }
  }

  // Node 11: Clone test codebase
  async function cloneTestCodebaseNode(_state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('📦 Step 11: Cloning test codebase...');

    try {
      const testRepo = process.env.GITHUB_TEST_REPO;
      const testBranch = process.env.BASE_TEST_BRANCH || 'master';
      const targetDir = path.join(process.cwd(), 'temp', 'test-codebase');

      if (!testRepo) {
        console.log('⚠️  No test repository configured, skipping...\n');
        return { testCodebasePath: null };
      }

      // Use test owner if provided, otherwise fall back to main owner
      const testOwner = process.env.GITHUB_TEST_OWNER || config.githubOwner;

      const gitCloneTool = new GitCloneTool({
        token: config.githubToken,
        owner: testOwner,
        repo: testRepo,
        branch: testBranch,
        targetDir,
      });

      const result = await gitCloneTool._call();
      const cloneResult = JSON.parse(result);

      console.log(`✅ Test codebase cloned to: ${cloneResult.path}\n`);

      return { testCodebasePath: cloneResult.path };
    } catch (error) {
      const errorMsg = `Failed to clone test codebase: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 12: Create test branch
  async function createTestBranchNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('🌿 Step 12: Creating test branch...');

    if (!state.testCodebasePath) {
      return { error: 'Missing test codebase path' };
    }

    try {
      const ticketNumber = state.jiraData?.ticketNumber || 'no-ticket';
      const parts = ticketNumber.split('-');
      const prefix = parts[0].toLowerCase();
      const branchName = `${prefix}/${ticketNumber}_change-log-updates`;

      const baseBranch = process.env.BASE_TEST_BRANCH || 'master';

      // Force checkout base branch, pull latest, delete existing branch, create new
      await execAsync(`cd "${state.testCodebasePath}" && git checkout -f ${baseBranch} && git pull origin ${baseBranch}`);

      try {
        await execAsync(`cd "${state.testCodebasePath}" && git branch -D ${branchName} 2>/dev/null || true`);
      } catch (error) {
        // Ignore if branch doesn't exist
      }

      await execAsync(`cd "${state.testCodebasePath}" && git checkout -b ${branchName}`);

      console.log(`✅ Created test branch: ${branchName}\n`);

      return { testFeatureBranch: branchName };
    } catch (error) {
      const errorMsg = `Failed to create test branch: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 13: Analyze endpoint changes impact on tests
  async function analyzeEndpointImpactNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('🔬 Step 13: Analyzing endpoint impact on tests...\n');

    if (!state.testCodebasePath || !state.diffData || !state.codebasePath) {
      return { error: 'Missing required data for endpoint analysis' };
    }

    try {
      // Create tools for test codebase only
      const testCodebaseSearch = new CodebaseSearchTool(state.testCodebasePath);
      const testCodebaseFile = new CodebaseFileTool(state.testCodebasePath);
      const testCodebaseStructure = new CodebaseStructureTool(state.testCodebasePath);

      const tools = [testCodebaseSearch, testCodebaseFile, testCodebaseStructure];

      const agentPrompt = ChatPromptTemplate.fromMessages([
        ['system', 'You are an expert API test analyst. Analyze endpoint changes and their impact on tests.'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}'],
      ]);

      const agent = await createToolCallingAgent({
        llm,
        tools,
        prompt: agentPrompt,
      });

      const agentExecutor = new AgentExecutor({
        agent,
        tools,
        verbose: false,
      });

      const analysisPrompt = `Analyze the following commit diff for API endpoint changes and determine what tests need updating.

COMMIT DIFF:
${state.diffData.diff}

JIRA TICKET: ${state.jiraData?.ticketNumber || 'N/A'}
TICKET DESCRIPTION: ${state.jiraData?.description || 'N/A'}

MAIN CODEBASE: ${state.codebasePath}
TEST CODEBASE: ${state.testCodebasePath}

Please provide a detailed analysis in JSON format:
{
  "endpointChanges": [
    {
      "endpoint": "path and method",
      "changeType": "new|modified|deleted",
      "description": "what changed",
      "affectedTests": ["list of test files that need updating"]
    }
  ],
  "documentationNeeded": "what docs need to be created/updated in docs/ folder",
  "testingNotes": "specific things to test and watch for based on ${state.jiraData?.ticketNumber}"
}`;

      const response = await agentExecutor.invoke({
        input: analysisPrompt,
      });

      const analysisText = typeof response.output === 'string'
        ? response.output
        : JSON.stringify(response.output);

      console.log('═══════════════════════════════════════════════════════════════');
      console.log('              🔬 ENDPOINT IMPACT ANALYSIS');
      console.log('═══════════════════════════════════════════════════════════════\n');
      console.log(analysisText);
      console.log('\n═══════════════════════════════════════════════════════════════\n');

      return { endpointAnalysis: analysisText };
    } catch (error) {
      const errorMsg = `Failed to analyze endpoint impact: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 14: Update test documentation and code
  async function updateTestCodeNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('📝 Step 14: Updating test documentation and code...\n');

    if (!state.testCodebasePath || !state.endpointAnalysis) {
      return { error: 'Missing required data for test updates' };
    }

    try {
      // Create file write tool for test codebase
      class TestCodebaseFileWriteTool extends Tool {
        name = 'test-codebase-file-write';
        description = 'Writes content to a file in the test codebase';
        private codebasePath: string;

        constructor(codebasePath: string) {
          super();
          this.codebasePath = codebasePath;
        }

        async _call(input: string): Promise<string> {
          const { filePath, content } = JSON.parse(input);
          const fullPath = path.join(this.codebasePath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf-8');
          return JSON.stringify({ success: true, filePath });
        }
      }

      const testCodebaseSearch = new CodebaseSearchTool(state.testCodebasePath);
      const testCodebaseFile = new CodebaseFileTool(state.testCodebasePath);
      const testCodebaseWrite = new TestCodebaseFileWriteTool(state.testCodebasePath);

      const tools = [testCodebaseSearch, testCodebaseFile, testCodebaseWrite];

      const agentPrompt = ChatPromptTemplate.fromMessages([
        ['system', 'You are an expert at updating API tests and documentation. Make precise, minimal changes.'],
        ['human', '{input}'],
        ['placeholder', '{agent_scratchpad}'],
      ]);

      const agent = await createToolCallingAgent({
        llm,
        tools,
        prompt: agentPrompt,
      });

      const agentExecutor = new AgentExecutor({
        agent,
        tools,
        verbose: false,
      });

      const updatePrompt = `Based on the endpoint analysis below, update the test codebase:

ENDPOINT ANALYSIS:
${state.endpointAnalysis}

JIRA TICKET: ${state.jiraData?.ticketNumber || 'N/A'}
TEST CODEBASE PATH: ${state.testCodebasePath}

Please:
1. Create/update endpoint documentation in docs/ folder with:
   - Endpoint details
   - Request/response format
   - Testing notes for ${state.jiraData?.ticketNumber}

2. Update test files in src/ to work with the new/modified endpoints
   - Update API calls
   - Fix any broken tests
   - Add new tests if needed

3. Add a testing notes file in docs/ named "${state.jiraData?.ticketNumber}-testing-notes.md" explaining:
   - What should be tested
   - Things to watch for
   - Expected behavior changes

Use the test-codebase-file-write tool to make all necessary changes.`;

      const response = await agentExecutor.invoke({
        input: updatePrompt,
      });

      console.log('═══════════════════════════════════════════════════════════════');
      console.log('              ✅ TEST CODE UPDATES');
      console.log('═══════════════════════════════════════════════════════════════\n');
      console.log(response.output);
      console.log('\n═══════════════════════════════════════════════════════════════\n');

      return { testUpdatesCompleted: true };
    } catch (error) {
      const errorMsg = `Failed to update test code: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 15: Run tests
  async function runTestsNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('🧪 Step 15: Running tests...\n');

    if (!state.testCodebasePath) {
      return { error: 'Missing test codebase path' };
    }

    try {
      // Run npm test
      const { stdout, stderr } = await execAsync(`cd "${state.testCodebasePath}" && npm test`);

      console.log('═══════════════════════════════════════════════════════════════');
      console.log('              🧪 TEST RESULTS');
      console.log('═══════════════════════════════════════════════════════════════\n');
      console.log(stdout);
      if (stderr) console.error(stderr);
      console.log('\n═══════════════════════════════════════════════════════════════\n');

      return {};
    } catch (error) {
      const errorMsg = `Tests failed: ${(error as Error).message}`;
      console.error(`⚠️  ${errorMsg}\n`);
      // Don't return error - tests failing is expected and should be fixed
      return {};
    }
  }

  // Node 16: Commit test changes
  async function commitTestChangesNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('💾 Step 16: Committing test changes...\n');

    if (!state.testCodebasePath || !state.testFeatureBranch) {
      return { error: 'Missing required data for commit' };
    }

    try {
      const ticketNumber = state.jiraData?.ticketNumber || 'Update';
      const commitMessage = `${ticketNumber} update tests for endpoint changes`;

      // Stage all changes
      await execAsync(`cd "${state.testCodebasePath}" && git add -A && git commit -m "${commitMessage}"`);

      console.log(`✅ Committed test changes with message: "${commitMessage}"\n`);

      return { testCommitCreated: true };
    } catch (error) {
      const errorMsg = `Failed to commit test changes: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  // Node 17: Create test PR
  async function createTestPRNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
    console.log('🔀 Step 17: Creating test pull request...\n');

    if (!state.testCodebasePath || !state.testFeatureBranch) {
      return { error: 'Missing required data for test PR' };
    }

    try {
      const ticketNumber = state.jiraData?.ticketNumber || 'Update';
      const ticketLink = state.jiraData?.found
        ? `\n\nJira: ${config.jiraHost}/browse/${state.jiraData.ticketNumber}`
        : '';

      // Ensure origin remote exists
      try {
        await execAsync(`cd "${state.testCodebasePath}" && git remote get-url origin`);
      } catch (error) {
        const testRepo = process.env.GITHUB_TEST_REPO;
        const testOwner = process.env.GITHUB_TEST_OWNER || config.githubOwner;
        const remoteUrl = `https://${config.githubToken}@github.com/${testOwner}/${testRepo}.git`;
        await execAsync(`cd "${state.testCodebasePath}" && git remote add origin ${remoteUrl}`);
      }

      // Push branch to remote
      await execAsync(`cd "${state.testCodebasePath}" && git push -u origin ${state.testFeatureBranch} --force`);

      // Create PR
      const prTitle = `${ticketNumber} update tests for endpoint changes`;
      const prBody = `Automated test updates for endpoint changes from ${ticketNumber}${ticketLink}\n\n**Changes:**\n${state.endpointAnalysis}`;

      const octokit = new Octokit({ auth: config.githubToken });
      const baseBranch = process.env.BASE_TEST_BRANCH || 'master';
      const testRepo = process.env.GITHUB_TEST_REPO;
      const testOwner = process.env.GITHUB_TEST_OWNER || config.githubOwner;

      const { data: pr } = await octokit.pulls.create({
        owner: testOwner,
        repo: testRepo!,
        title: prTitle,
        body: prBody,
        head: state.testFeatureBranch,
        base: baseBranch,
      });

      console.log(`✅ Test pull request created: ${pr.html_url}\n`);

      return { testPullRequestUrl: pr.html_url };
    } catch (error) {
      const errorMsg = `Failed to create test PR: ${(error as Error).message}`;
      console.error(`❌ ${errorMsg}\n`);
      return { error: errorMsg };
    }
  }

  return {
    fetchCommitNode,
    fetchDiffNode,
    extractJiraNode,
    cloneCodebaseNode,
    generateSummaryNode,
    updateChangelogNode,
    createBranchNode,
    commitChangelogNode,
    createPRNode,
    detectEndpointChangesNode,
    cloneTestCodebaseNode,
    createTestBranchNode,
    analyzeEndpointImpactNode,
    updateTestCodeNode,
    runTestsNode,
    commitTestChangesNode,
    createTestPRNode,
  };
}
