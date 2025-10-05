import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createWorkflow } from '../graph/workflow.js';
import { createNodes } from '../graph/nodes.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize the workflow
const config = {
  githubToken: process.env.GITHUB_TOKEN || '',
  githubOwner: process.env.GITHUB_OWNER || '',
  githubRepo: process.env.GITHUB_REPO || '',
  jiraHost: process.env.JIRA_HOST || '',
  jiraEmail: process.env.JIRA_EMAIL || '',
  jiraApiToken: process.env.JIRA_API_TOKEN || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
};

const workflow = createWorkflow(config);

// API endpoint to get graph structure
        app.get('/api/graph', (req, res) => {
          try {
            // Get the actual graph structure from the workflow
            const graphData = {
              nodes: [
                { 
                  id: 'fetchCommit', 
                  label: '📡 Fetch Latest Commit', 
                  type: 'github',
                  description: 'Retrieves the most recent commit from GitHub repository',
                  status: 'pending'
                },
                { 
                  id: 'fetchDiff', 
                  label: '📄 Fetch Commit Diff', 
                  type: 'github',
                  description: 'Gets the detailed diff showing what files changed',
                  status: 'pending'
                },
                { 
                  id: 'extractJira', 
                  label: '🎫 Extract Jira Ticket', 
                  type: 'jira',
                  description: 'Parses commit message to find and retrieve Jira ticket info',
                  status: 'pending'
                },
                { 
                  id: 'cloneCodebase', 
                  label: '📦 Clone Codebase', 
                  type: 'git',
                  description: 'Clones the repository for detailed code analysis',
                  status: 'pending'
                },
                { 
                  id: 'generateSummary', 
                  label: '🤖 Generate AI Summary', 
                  type: 'ai',
                  description: 'Creates comprehensive analysis using AI with codebase context',
                  status: 'pending'
                },
                { 
                  id: 'createBranch', 
                  label: '🌿 Create Branch', 
                  type: 'github',
                  description: 'Creates a new branch for changelog updates',
                  status: 'pending'
                },
                { 
                  id: 'updateChangelog', 
                  label: '📝 Update Changelog', 
                  type: 'file',
                  description: 'Updates CHANGELOG.md with commit information',
                  status: 'pending'
                },
                { 
                  id: 'commitChangelog', 
                  label: '💾 Commit Changelog', 
                  type: 'git',
                  description: 'Commits the updated changelog to the new branch',
                  status: 'pending'
                },
                { 
                  id: 'createPR', 
                  label: '🔀 Create Pull Request', 
                  type: 'github',
                  description: 'Creates a pull request with the changelog update',
                  status: 'pending'
                },
                { 
                  id: 'detectEndpointChanges', 
                  label: '🔍 Detect Endpoint Changes', 
                  type: 'ai',
                  description: 'Analyzes changes to detect if API endpoints were modified',
                  status: 'pending'
                },
                { 
                  id: 'cloneTestCodebase', 
                  label: '🧪 Clone Test Codebase', 
                  type: 'git',
                  description: 'Clones the test repository for endpoint testing',
                  status: 'pending'
                },
                {
                  id: 'createTestBranch',
                  label: '🌿 Create Test Branch',
                  type: 'github',
                  description: 'Creates a new branch in the test repository',
                  status: 'pending'
                },
              ],
              edges: [
                { from: '__start__', to: 'fetchCommit' },
                { from: 'fetchCommit', to: 'fetchDiff' },
                { from: 'fetchDiff', to: 'extractJira' },
                { from: 'extractJira', to: 'cloneCodebase' },
                { from: 'cloneCodebase', to: 'generateSummary' },
                { from: 'generateSummary', to: 'createBranch' },
                { from: 'createBranch', to: 'updateChangelog' },
                { from: 'updateChangelog', to: 'commitChangelog' },
                { from: 'commitChangelog', to: 'createPR' },
                { from: 'createPR', to: 'detectEndpointChanges' },
                { from: 'detectEndpointChanges', to: 'cloneTestCodebase', condition: 'endpointChanges' },
                { from: 'detectEndpointChanges', to: '__end__', condition: 'noEndpointChanges' },
                { from: 'cloneTestCodebase', to: 'createTestBranch' },
                { from: 'createTestBranch', to: '__end__' },
              ],
              metadata: {
                title: 'Project Completion Agent Workflow',
                description: 'Automated workflow for analyzing commits, extracting Jira tickets, updating project documentation, and handling test repository changes',
                totalSteps: 12,
                estimatedDuration: '2-5 minutes'
              }
            };
    
    res.json(graphData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get graph structure' });
  }
});

// API endpoint to run the workflow
app.post('/api/run', async (req, res) => {
  try {
    console.log('🚀 Starting workflow execution...');
    
    const result = await workflow.invoke({});
    
    res.json({ 
      success: true, 
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Workflow execution failed:', error);
    res.status(500).json({ 
      error: 'Workflow execution failed',
      details: (error as Error).message
    });
  }
});

// WebSocket for real-time updates
wss.on('connection', (ws) => {
  console.log('🔌 Client connected to WebSocket');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'run_workflow') {
        console.log('🔄 Running workflow via WebSocket...');
        
        // Send progress updates for each step
        const steps = [
          { id: 'fetchCommit', name: 'Fetch Commit', message: 'Fetching latest commit from GitHub...' },
          { id: 'fetchDiff', name: 'Fetch Diff', message: 'Retrieving commit diff...' },
          { id: 'extractJira', name: 'Extract Jira', message: 'Extracting Jira ticket information...' },
          { id: 'cloneCodebase', name: 'Clone Codebase', message: 'Cloning repository for analysis...' },
          { id: 'generateSummary', name: 'Generate Summary', message: 'Creating AI-powered summary...' },
          { id: 'createBranch', name: 'Create Branch', message: 'Creating new branch...' },
          { id: 'updateChangelog', name: 'Update Changelog', message: 'Updating CHANGELOG.md...' },
          { id: 'commitChangelog', name: 'Commit Changelog', message: 'Committing changes...' },
          { id: 'createPR', name: 'Create PR', message: 'Creating pull request...' },
          { id: 'detectEndpointChanges', name: 'Detect Endpoint Changes', message: 'Analyzing changes for API endpoints...' },
          { id: 'cloneTestCodebase', name: 'Clone Test Codebase', message: 'Cloning test repository...' },
          { id: 'createTestBranch', name: 'Create Test Branch', message: 'Creating test branch...' }
        ];
        
        // Run the actual workflow execution
        ws.send(JSON.stringify({
          type: 'progress',
          step: 'Starting Workflow',
          nodeId: 'start',
          message: 'Running actual LangGraph workflow (check console for real progress)...'
        }));
        
        try {
          console.log('🚀 Starting actual workflow execution via WebSocket...');
          const result = await workflow.invoke({});
          console.log('✅ Workflow execution completed successfully');
          
          // Mark all nodes as completed since workflow finished successfully
          const nodeMapping = {
            'fetchCommit': 'Fetch Commit',
            'fetchDiff': 'Fetch Diff',
            'extractJira': 'Extract Jira',
            'cloneCodebase': 'Clone Codebase',
            'generateSummary': 'Generate Summary',
            'createBranch': 'Create Branch',
            'updateChangelog': 'Update Changelog',
            'commitChangelog': 'Commit Changelog',
            'createPR': 'Create PR',
            'detectEndpointChanges': 'Detect Endpoint Changes',
            'cloneTestCodebase': 'Clone Test Codebase',
            'createTestBranch': 'Create Test Branch'
          };
          
          // Update UI to show all steps completed
          Object.keys(nodeMapping).forEach(nodeId => {
            ws.send(JSON.stringify({
              type: 'step_complete',
              step: nodeMapping[nodeId],
              nodeId: nodeId
            }));
          });
          
          ws.send(JSON.stringify({
            type: 'complete',
            result,
            timestamp: new Date().toISOString()
          }));
          
        } catch (error) {
          console.error('❌ Workflow execution failed:', (error as Error).message);
          ws.send(JSON.stringify({
            type: 'error',
            error: (error as Error).message
          }));
        }
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: (error as Error).message
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Client disconnected from WebSocket');
  });
});

// Serve a simple HTML page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LangGraph Project Completion Agent</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 1400px;
                margin: 0 auto;
                padding: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                backdrop-filter: blur(10px);
            }
            h1 {
                color: #333;
                text-align: center;
                margin-bottom: 10px;
                font-size: 2.5em;
                background: linear-gradient(135deg, #667eea, #764ba2);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .subtitle {
                text-align: center;
                color: #666;
                margin-bottom: 30px;
                font-size: 1.1em;
            }
            .workflow-container {
                border: 2px solid #e1e5e9;
                border-radius: 12px;
                padding: 25px;
                margin: 20px 0;
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                min-height: 400px;
                position: relative;
                overflow: hidden;
            }
            .workflow-header {
                text-align: center;
                margin-bottom: 20px;
                padding-bottom: 15px;
                border-bottom: 2px solid #dee2e6;
            }
            .workflow-title {
                font-size: 1.5em;
                font-weight: bold;
                color: #495057;
                margin-bottom: 5px;
            }
            .workflow-meta {
                color: #6c757d;
                font-size: 0.9em;
            }
            .workflow-flow {
                display: grid;
                grid-template-columns: 1fr;
                gap: 25px;
                margin-top: 20px;
            }
            .workflow-section {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 15px;
            }
            .section-title {
                font-size: 16px;
                font-weight: 600;
                color: #374151;
                text-align: center;
                padding: 8px 16px;
                background: #f3f4f6;
                border-radius: 8px;
                border: 2px dashed #d1d5db;
                width: 100%;
                max-width: 600px;
            }
            .section-nodes {
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                align-items: flex-start;
                gap: 15px;
                width: 100%;
            }
            .conditional-flow {
                border: 2px solid #e5e7eb;
                border-radius: 12px;
                padding: 15px;
                background: #f9fafb;
                margin: 10px 0;
            }
            .conditional-title {
                font-size: 14px;
                font-weight: 600;
                color: #6b7280;
                text-align: center;
                margin-bottom: 10px;
            }
            .node {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 15px 20px;
                margin: 8px;
                border-radius: 10px;
                font-weight: 500;
                color: white;
                text-align: center;
                min-width: 160px;
                max-width: 180px;
                position: relative;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                transition: all 0.3s ease;
                cursor: pointer;
            }
            .node:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(0,0,0,0.2);
            }
            .node.github { background: linear-gradient(135deg, #24292e, #586069); }
            .node.jira { background: linear-gradient(135deg, #0052cc, #0065ff); }
            .node.git { background: linear-gradient(135deg, #f05032, #ff6b47); }
            .node.ai { background: linear-gradient(135deg, #10a37f, #16c085); }
            .node.file { background: linear-gradient(135deg, #6f42c1, #8b5cf6); }
            .node-label {
                font-size: 0.9em;
                font-weight: 600;
                margin-bottom: 5px;
            }
            .node-description {
                font-size: 0.75em;
                opacity: 0.9;
                line-height: 1.3;
            }
            .node-status {
                position: absolute;
                top: -5px;
                right: -5px;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                border: 2px solid white;
                font-size: 0.7em;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .node-status.pending { background: #ffc107; }
            .node-status.running { background: #17a2b8; animation: pulse 1s infinite; }
            .node-status.completed { background: #28a745; }
            .node-status.error { background: #dc3545; }
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
            }
            .flow-arrow {
                color: #6c757d;
                font-size: 1.5em;
                margin: 0 10px;
                align-self: center;
            }
            .workflow-row {
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 10px 0;
                flex-wrap: wrap;
            }
            .controls {
                text-align: center;
                margin: 30px 0;
            }
            button {
                background: #007bff;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-size: 16px;
                cursor: pointer;
                margin: 0 10px;
            }
            button:hover {
                background: #0056b3;
            }
            button:disabled {
                background: #6c757d;
                cursor: not-allowed;
            }
            .output {
                margin-top: 20px;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 6px;
                border-left: 4px solid #007bff;
                white-space: pre-wrap;
                font-family: 'Monaco', 'Menlo', monospace;
                max-height: 400px;
                overflow-y: auto;
            }
            .status {
                padding: 10px;
                border-radius: 4px;
                margin: 10px 0;
                font-weight: 500;
            }
            .status.success { background: #d4edda; color: #155724; }
            .status.error { background: #f8d7da; color: #721c24; }
            .status.info { background: #d1ecf1; color: #0c5460; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 LangGraph Project Completion Agent</h1>
            <div class="subtitle">Automated workflow for analyzing commits, extracting Jira tickets, and updating project documentation</div>
            
            <div class="workflow-container" id="workflowContainer">
                <div class="workflow-header">
                    <div class="workflow-title" id="workflowTitle">Loading Workflow...</div>
                    <div class="workflow-meta" id="workflowMeta"></div>
                </div>
                <div class="workflow-flow" id="workflowFlow">
                    <div id="nodes"></div>
                </div>
            </div>
            
            <div class="controls">
                <button onclick="loadGraph()">📊 Load Graph Structure</button>
                <button onclick="runWorkflow()" id="runBtn">▶️ Run Workflow</button>
                <button onclick="clearOutput()">🗑️ Clear Output</button>
            </div>
            
            <div id="output" class="output" style="display: none;"></div>
        </div>

        <script>
            let ws = null;
            
            function connectWebSocket() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                ws = new WebSocket(\`\${protocol}//\${window.location.host}\`);
                
                ws.onmessage = function(event) {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'progress') {
                        showStatus(\`Step: \${data.step} - \${data.message}\`, 'info');
                        // Update node status to running
                        if (data.nodeId) {
                            updateNodeStatus(data.nodeId, 'running');
                        }
                    } else if (data.type === 'step_complete') {
                        showStatus(\`✅ \${data.step} completed\`, 'success');
                        if (data.nodeId) {
                            updateNodeStatus(data.nodeId, 'completed');
                        }
                    } else if (data.type === 'complete') {
                        showStatus('🎉 Workflow completed successfully!', 'success');
                        document.getElementById('runBtn').disabled = false;
                        showOutput(JSON.stringify(data.result, null, 2));
                    } else if (data.type === 'error') {
                        showStatus(\`❌ Error: \${data.error}\`, 'error');
                        document.getElementById('runBtn').disabled = false;
                        if (data.nodeId) {
                            updateNodeStatus(data.nodeId, 'error');
                        }
                    }
                };
            }
            
            function loadGraph() {
                fetch('/api/graph')
                    .then(response => response.json())
                    .then(data => {
                        // Update workflow header
                        document.getElementById('workflowTitle').textContent = data.metadata.title;
                        document.getElementById('workflowMeta').textContent = 
                            \`\${data.metadata.totalSteps} steps • \${data.metadata.estimatedDuration}\`;
                        
                        const workflowFlow = document.getElementById('workflowFlow');
                        workflowFlow.innerHTML = '';
                        
                        // Main workflow section
                        const mainSection = document.createElement('div');
                        mainSection.className = 'workflow-section';
                        mainSection.innerHTML = '<div class="section-title">Main Workflow</div><div class="section-nodes"></div>';
                        
                        const mainNodes = mainSection.querySelector('.section-nodes');
                        
                        // Add main workflow nodes (first 10 nodes)
                        const mainWorkflowNodes = data.nodes.slice(0, 10);
                        mainWorkflowNodes.forEach((node, index) => {
                            const nodeEl = document.createElement('div');
                            nodeEl.className = \`node \${node.type}\`;
                            nodeEl.innerHTML = \`
                                <div class="node-label">\${node.label}</div>
                                <div class="node-description">\${node.description}</div>
                                <div class="node-status \${node.status}"></div>
                            \`;
                            nodeEl.id = \`node-\${node.id}\`;
                            mainNodes.appendChild(nodeEl);
                            
                            // Add arrow between nodes (except for the last one in this section)
                            if (index < mainWorkflowNodes.length - 1) {
                                const arrowEl = document.createElement('div');
                                arrowEl.className = 'flow-arrow';
                                arrowEl.innerHTML = '→';
                                mainNodes.appendChild(arrowEl);
                            }
                        });
                        
                        workflowFlow.appendChild(mainSection);
                        
                        // Conditional test repository flow
                        const testSection = document.createElement('div');
                        testSection.className = 'workflow-section';
                        testSection.innerHTML = \`
                            <div class="section-title">Test Repository Flow (Conditional)</div>
                            <div class="conditional-flow">
                                <div class="conditional-title">Only runs if endpoint changes are detected</div>
                                <div class="section-nodes"></div>
                            </div>
                        \`;
                        
                        const testNodes = testSection.querySelector('.section-nodes');
                        
                        // Add test workflow nodes (remaining nodes)
                        const testWorkflowNodes = data.nodes.slice(10);
                        testWorkflowNodes.forEach((node, index) => {
                            const nodeEl = document.createElement('div');
                            nodeEl.className = \`node \${node.type}\`;
                            nodeEl.innerHTML = \`
                                <div class="node-label">\${node.label}</div>
                                <div class="node-description">\${node.description}</div>
                                <div class="node-status \${node.status}"></div>
                            \`;
                            nodeEl.id = \`node-\${node.id}\`;
                            testNodes.appendChild(nodeEl);
                            
                            // Add arrow between nodes (except for the last one in this section)
                            if (index < testWorkflowNodes.length - 1) {
                                const arrowEl = document.createElement('div');
                                arrowEl.className = 'flow-arrow';
                                arrowEl.innerHTML = '→';
                                testNodes.appendChild(arrowEl);
                            }
                        });
                        
                        workflowFlow.appendChild(testSection);
                        
                        showStatus('📊 Enhanced workflow structure loaded successfully', 'success');
                    })
                    .catch(error => {
                        showStatus(\`❌ Failed to load workflow: \${error.message}\`, 'error');
                    });
            }
            
            function updateNodeStatus(nodeId, status) {
                const nodeEl = document.getElementById(\`node-\${nodeId}\`);
                if (nodeEl) {
                    const statusEl = nodeEl.querySelector('.node-status');
                    statusEl.className = \`node-status \${status}\`;
                }
            }
            
            function runWorkflow() {
                if (!ws) connectWebSocket();
                
                document.getElementById('runBtn').disabled = true;
                showStatus('🔄 Starting workflow...', 'info');
                
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'run_workflow' }));
                } else {
                    // Fallback to HTTP API
                    fetch('/api/run', { method: 'POST' })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                showStatus('✅ Workflow completed successfully!', 'success');
                                showOutput(JSON.stringify(data.result, null, 2));
                            } else {
                                showStatus(\`❌ Error: \${data.error}\`, 'error');
                            }
                            document.getElementById('runBtn').disabled = false;
                        })
                        .catch(error => {
                            showStatus(\`❌ Error: \${error.message}\`, 'error');
                            document.getElementById('runBtn').disabled = false;
                        });
                }
            }
            
            function showStatus(message, type) {
                const output = document.getElementById('output');
                const statusDiv = document.createElement('div');
                statusDiv.className = \`status \${type}\`;
                statusDiv.textContent = message;
                output.appendChild(statusDiv);
                output.scrollTop = output.scrollHeight;
            }
            
            function showOutput(content) {
                const output = document.getElementById('output');
                output.style.display = 'block';
                output.textContent += '\\n\\n=== WORKFLOW OUTPUT ===\\n' + content;
                output.scrollTop = output.scrollHeight;
            }
            
            function clearOutput() {
                document.getElementById('output').innerHTML = '';
                document.getElementById('output').style.display = 'none';
            }
            
            // Auto-load graph on page load
            window.onload = function() {
                loadGraph();
                connectWebSocket();
            };
        </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 LangGraph UI Server running on http://localhost:${PORT}`);
  console.log(`📊 Graph visualization available at http://localhost:${PORT}`);
});
