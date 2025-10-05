import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
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
  jiraHost: string;
  jiraEmail: string;
  jiraApiToken: string;
  openaiApiKey: string;
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

  const llm = new ChatOpenAI({
    modelName: 'gpt-4.1-mini',
    temperature: 0,
    openAIApiKey: config.openaiApiKey,
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

      return { summary: response.output };
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

      // Extract concise description from summary (find bullets after "Summary of changes")
      const summaryLines = state.summary.split('\n').filter(line => line.trim());
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
${state.summary}

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
  };
}
