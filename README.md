# Project Completion - LangGraph Commit Analysis

A TypeScript LangGraph project that orchestrates multiple AI agents to analyze GitHub commits, extract Jira ticket information, and generate AI-powered summaries of code changes.

## Features

- **LangGraph Workflow**: Uses LangGraph to create a stateful, multi-agent workflow
- **TypeScript**: Fully typed codebase for better developer experience and type safety
- **GitHub Integration**: Monitors repository commits using the Octokit GitHub API
- **Commit Diff Retrieval**: Fetches detailed commit diffs via HTTP
- **Jira Integration**: Automatically extracts Jira ticket numbers from commit messages and retrieves ticket details
- **AI-Powered Analysis**: Uses ChatGPT to generate comprehensive summaries combining commit changes and Jira context

## Architecture

The project uses **LangGraph** to create a state machine with the following nodes:

1. **fetchCommit** - Retrieves the latest commit from a specified repository
2. **fetchDiff** - Fetches the full diff for a commit hash
3. **extractJira** - Extracts Jira ticket numbers (e.g., PROJ-123) from commit messages and retrieves ticket details
4. **generateSummary** - Uses ChatGPT LLM to analyze all gathered data and produce a comprehensive summary

### Graph Flow

```
START → fetchCommit → fetchDiff → extractJira → generateSummary → END
```

Each node updates the shared state, which flows through the graph and is accessible to all nodes.

## Prerequisites

- Node.js 18+
- TypeScript 5+
- GitHub Personal Access Token
- Jira API Token
- OpenAI API Key

## Installation

1. Clone the repository:
```bash
cd project-completion
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your credentials:
```env
# GitHub Configuration
GITHUB_TOKEN=your_github_personal_access_token
GITHUB_OWNER=repository_owner
GITHUB_REPO=repository_name

# Jira Configuration
JIRA_HOST=https://yourdomain.atlassian.net
JIRA_EMAIL=your_email@example.com
JIRA_API_TOKEN=your_jira_api_token

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
```

## Usage

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### Build TypeScript
```bash
npm run build
```

The application will:
1. Fetch the latest commit from your GitHub repository
2. Retrieve the commit diff
3. Extract any Jira ticket numbers from the commit message
4. Fetch Jira ticket details (if found)
5. Generate an AI summary combining all information

## Project Structure

```
project-completion/
├── src/
│   ├── graph/
│   │   ├── state.ts          # LangGraph state definition
│   │   ├── nodes.ts          # Graph node implementations
│   │   └── workflow.ts       # LangGraph workflow configuration
│   ├── tools/
│   │   ├── githubTools.ts    # GitHub tools using Octokit
│   │   └── jiraTools.ts      # Jira tools using Axios
│   └── index.ts              # Entry point
├── dist/                     # Compiled TypeScript output
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## How It Works

### LangGraph State Management
The workflow uses a shared state object that flows through each node:

```typescript
interface GraphState {
  commitData: CommitData | null;
  diffData: CommitDiffData | null;
  jiraData: JiraTicketData | null;
  summary: string | null;
  error: string | null;
}
```

### 1. GitHub Commit Listener (Node)
Uses **@octokit/rest** library to fetch the latest commit:
```typescript
const commitData = await githubCommitListener._call();
// Returns: { hash, message, author, date, url }
```

### 2. Commit Diff Retrieval (Node)
Retrieves the full diff using the commit hash via **Octokit**:
```typescript
const diffData = await githubCommitDiff._call(commitHash);
// Returns: { hash, message, diff, filesChanged[] }
```

### 3. Jira Ticket Extraction (Node)
Uses **JiraProjectLoader** from `@langchain/community` to extract ticket information:
```typescript
const jiraData = await jiraTicketExtractor._call(commitMessage);
// Returns: { found, ticketNumber, summary, description, status, ... }
```

The tool extracts the project key from the ticket number (e.g., "PROJ" from "PROJ-123") and uses the LangChain JiraProjectLoader to fetch all issues from that project, then finds the specific ticket.

### 4. AI Summary Generation (Node)
Passes all data to ChatGPT (via **@langchain/openai**) for comprehensive analysis:
```typescript
const summary = await llm.invoke(prompt);
// Returns detailed summary of changes, purpose, and impacts
```

## Example Output

```
🚀 Starting Commit Analysis Graph with LangGraph...

📡 Step 1: Fetching latest commit from GitHub...
✅ Found commit: a1b2c3d
   Message: PROJ-123: Add user authentication feature
   Author: John Doe

📄 Step 2: Retrieving commit diff...
✅ Retrieved diff for 3 file(s)
   - src/auth/login.ts (+45/-12)
   - src/middleware/auth.ts (+30/-5)
   - tests/auth.test.ts (+60/-0)

🎫 Step 3: Extracting Jira ticket information...
✅ Found Jira ticket: PROJ-123
   Summary: Implement OAuth2 authentication
   Status: In Progress
   Type: Story

🤖 Step 4: Generating AI summary...

═══════════════════════════════════════════════════════════════
                    📋 COMMIT ANALYSIS SUMMARY
═══════════════════════════════════════════════════════════════

[AI-generated summary appears here...]
```

## Technologies Used

- **LangGraph** (`@langchain/langgraph`) - Stateful workflow orchestration
- **TypeScript** - Type-safe development
- **@octokit/rest** - Official GitHub API client
- **JiraProjectLoader** (`@langchain/community`) - LangChain's Jira integration
- **@langchain/openai** - ChatGPT integration
- **dotenv** - Environment variable management

## Configuration

### GitHub Token
Create a Personal Access Token at: https://github.com/settings/tokens
Required scopes: `repo` (for private repos) or `public_repo` (for public repos)

### Jira API Token
Create an API token at: https://id.atlassian.com/manage-profile/security/api-tokens

### OpenAI API Key
Get your API key from: https://platform.openai.com/api-keys

## License

ISC
