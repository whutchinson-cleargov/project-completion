import { StateGraph, END } from '@langchain/langgraph';
import { GraphState, GraphStateType } from './state.js';
import { createNodes, NodeConfig } from './nodes.js';

export function createWorkflow(config: NodeConfig) {
  // Create nodes with configuration
  const nodes = createNodes(config);

  // Helper function to route based on error state
  const shouldContinue = (state: GraphStateType) => {
    return state.error ? END : 'continue';
  };

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
    .addNode('detectEndpointChanges', nodes.detectEndpointChangesNode)
    .addNode('cloneTestCodebase', nodes.cloneTestCodebaseNode)
    .addNode('createTestBranch', nodes.createTestBranchNode)
    // Define the flow with error checking
    .addEdge('__start__', 'fetchCommit')
    .addConditionalEdges('fetchCommit', shouldContinue, { continue: 'fetchDiff', [END]: END })
    .addConditionalEdges('fetchDiff', shouldContinue, { continue: 'extractJira', [END]: END })
    .addConditionalEdges('extractJira', shouldContinue, { continue: 'cloneCodebase', [END]: END })
    .addConditionalEdges('cloneCodebase', shouldContinue, { continue: 'generateSummary', [END]: END })
    .addConditionalEdges('generateSummary', shouldContinue, { continue: 'createBranch', [END]: END })
    .addConditionalEdges('createBranch', shouldContinue, { continue: 'updateChangelog', [END]: END })
    .addConditionalEdges('updateChangelog', shouldContinue, { continue: 'commitChangelog', [END]: END })
    .addConditionalEdges('commitChangelog', shouldContinue, { continue: 'createPR', [END]: END })
    .addConditionalEdges('createPR', shouldContinue, { continue: 'detectEndpointChanges', [END]: END })
    // Conditional routing: if endpoint changes detected, go to test repo flow
    .addConditionalEdges(
      'detectEndpointChanges',
      (state: GraphStateType) => {
        if (state.error) return END;
        return state.endpointChanges ? 'cloneTestCodebase' : END;
      },
      {
        cloneTestCodebase: 'cloneTestCodebase',
        [END]: END,
      }
    )
    .addConditionalEdges('cloneTestCodebase', shouldContinue, { continue: 'createTestBranch', [END]: END })
    .addEdge('createTestBranch', END);

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
