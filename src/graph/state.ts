import { Annotation } from '@langchain/langgraph';
import { CommitData, CommitDiffData } from '../tools/githubTools.js';
import { JiraTicketData } from '../tools/jiraTools.js';

// Define the state structure for the LangGraph workflow
export const GraphState = Annotation.Root({
  // GitHub commit data
  commitData: Annotation<CommitData | null>({
    reducer: (_, newValue) => newValue,
    default: () => null,
  }),

  // Commit diff data
  diffData: Annotation<CommitDiffData | null>({
    reducer: (_, newValue) => newValue,
    default: () => null,
  }),

  // Jira ticket data
  jiraData: Annotation<JiraTicketData | null>({
    reducer: (_, newValue) => newValue,
    default: () => null,
  }),

  // Path to cloned codebase
  codebasePath: Annotation<string | null>({
    reducer: (_, newValue) => newValue,
    default: () => null,
  }),

  // Branch name for checkout
  branchName: Annotation<string | null>({
    reducer: (_, newValue) => newValue,
    default: () => null,
  }),

  // AI-generated summary
  summary: Annotation<string | null>({
    reducer: (_, newValue) => newValue,
    default: () => null,
  }),

  // Changelog entry added
  changelogUpdated: Annotation<boolean>({
    reducer: (_, newValue) => newValue,
    default: () => false,
  }),

  // Branch created for changes
  featureBranch: Annotation<string | null>({
    reducer: (_, newValue) => newValue,
    default: () => null,
  }),

  // Commit created
  commitCreated: Annotation<boolean>({
    reducer: (_, newValue) => newValue,
    default: () => false,
  }),

  // Pull request URL
  pullRequestUrl: Annotation<string | null>({
    reducer: (_, newValue) => newValue,
    default: () => null,
  }),

  // Error tracking
  error: Annotation<string | null>({
    reducer: (_, newValue) => newValue,
    default: () => null,
  }),
});

export type GraphStateType = typeof GraphState.State;
