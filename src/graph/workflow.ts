import { StateGraph, END } from '@langchain/langgraph';
import { GraphState, GraphStateType } from './state.js';
import { createNodes, NodeConfig } from './nodes.js';

export function createWorkflow(config: NodeConfig) {
  // Create nodes with configuration
  const nodes = createNodes(config);

  // Create the graph
  const workflow = new StateGraph(GraphState)
    // Add nodes to the graph
    .addNode('fetchCommit', nodes.fetchCommitNode)
    .addNode('fetchDiff', nodes.fetchDiffNode)
    .addNode('extractJira', nodes.extractJiraNode)
    .addNode('cloneCodebase', nodes.cloneCodebaseNode)
    .addNode('generateSummary', nodes.generateSummaryNode)
    .addNode('createBranch', nodes.createBranchNode)
    .addNode('updateChangelog', nodes.updateChangelogNode)
    .addNode('commitChangelog', nodes.commitChangelogNode)
    .addNode('createPR', nodes.createPRNode)
    // Define the flow
    .addEdge('__start__', 'fetchCommit')
    .addEdge('fetchCommit', 'fetchDiff')
    .addEdge('fetchDiff', 'extractJira')
    .addEdge('extractJira', 'cloneCodebase')
    .addEdge('cloneCodebase', 'generateSummary')
    .addEdge('generateSummary', 'createBranch')
    .addEdge('createBranch', 'updateChangelog')
    .addEdge('updateChangelog', 'commitChangelog')
    .addEdge('commitChangelog', 'createPR')
    .addEdge('createPR', END);

  return workflow.compile();
}

export async function runCommitAnalysisGraph(config: NodeConfig) {
  console.log('🚀 Starting Commit Analysis Graph with LangGraph...\n');

  try {
    const app = createWorkflow(config);

    // Execute the graph
    const result = await app.invoke({});

    if (result.error) {
      throw new Error(result.error);
    }

    return {
      commit: result.commitData,
      diff: result.diffData,
      jira: result.jiraData,
      summary: result.summary,
    };
  } catch (error) {
    console.error('❌ Error in commit analysis graph:', (error as Error).message);
    throw error;
  }
}
