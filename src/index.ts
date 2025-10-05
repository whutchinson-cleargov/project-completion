import 'dotenv/config';
import { runCommitAnalysisGraph } from './graph/workflow.js';

async function main() {
  // Validate environment variables
  const requiredEnvVars = [
    'GITHUB_TOKEN',
    'GITHUB_OWNER',
    'GITHUB_REPO',
    'JIRA_HOST',
    'JIRA_EMAIL',
    'JIRA_API_TOKEN',
    'ANTHROPIC_API_KEY',
  ];

  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach((varName) => console.error(`   - ${varName}`));
    console.error('\nPlease create a .env file based on .env.example\n');
    process.exit(1);
  }

  try {
    await runCommitAnalysisGraph({
      githubToken: process.env.GITHUB_TOKEN!,
      githubOwner: process.env.GITHUB_OWNER!,
      githubRepo: process.env.GITHUB_REPO!,
      jiraHost: process.env.JIRA_HOST!,
      jiraEmail: process.env.JIRA_EMAIL!,
      jiraApiToken: process.env.JIRA_API_TOKEN!,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    });
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
