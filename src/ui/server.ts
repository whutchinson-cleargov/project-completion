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
  openaiApiKey: process.env.OPENAI_API_KEY || '',
};

const workflow = createWorkflow(config);

// API endpoint to get graph structure
app.get('/api/graph', (req, res) => {
  try {
    // Get the graph structure from LangGraph
    const graphData = {
      nodes: [
        { id: 'fetchCommit', label: 'Fetch Commit', type: 'github' },
        { id: 'fetchDiff', label: 'Fetch Diff', type: 'github' },
        { id: 'extractJira', label: 'Extract Jira', type: 'jira' },
        { id: 'cloneCodebase', label: 'Clone Codebase', type: 'git' },
        { id: 'generateSummary', label: 'Generate Summary', type: 'ai' },
      ],
      edges: [
        { from: 'fetchCommit', to: 'fetchDiff' },
        { from: 'fetchCommit', to: 'extractJira' },
        { from: 'fetchCommit', to: 'cloneCodebase' },
        { from: 'fetchDiff', to: 'generateSummary' },
        { from: 'extractJira', to: 'generateSummary' },
        { from: 'cloneCodebase', to: 'generateSummary' },
      ],
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
    
    const result = await workflow.invoke({
      messages: [],
    });
    
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
        
        // Send progress updates
        ws.send(JSON.stringify({
          type: 'progress',
          step: 'fetchCommit',
          message: 'Fetching latest commit from GitHub...'
        }));
        
        const result = await workflow.invoke({
          messages: [],
        });
        
        ws.send(JSON.stringify({
          type: 'complete',
          result,
          timestamp: new Date().toISOString()
        }));
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
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
                background: #f5f5f5;
            }
            .container {
                background: white;
                border-radius: 8px;
                padding: 30px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
                color: #333;
                text-align: center;
                margin-bottom: 30px;
            }
            .graph-container {
                border: 2px solid #e1e5e9;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
                background: #f8f9fa;
                min-height: 300px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-direction: column;
            }
            .node {
                display: inline-block;
                padding: 10px 20px;
                margin: 5px;
                border-radius: 6px;
                font-weight: 500;
                color: white;
                text-align: center;
                min-width: 120px;
            }
            .node.github { background: #24292e; }
            .node.jira { background: #0052cc; }
            .node.git { background: #f05032; }
            .node.ai { background: #10a37f; }
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
            
            <div class="graph-container" id="graphContainer">
                <h3>Workflow Graph</h3>
                <div id="nodes"></div>
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
                    } else if (data.type === 'complete') {
                        showStatus('✅ Workflow completed successfully!', 'success');
                        document.getElementById('runBtn').disabled = false;
                        showOutput(JSON.stringify(data.result, null, 2));
                    } else if (data.type === 'error') {
                        showStatus(\`❌ Error: \${data.error}\`, 'error');
                        document.getElementById('runBtn').disabled = false;
                    }
                };
            }
            
            function loadGraph() {
                fetch('/api/graph')
                    .then(response => response.json())
                    .then(data => {
                        const nodesContainer = document.getElementById('nodes');
                        nodesContainer.innerHTML = '';
                        
                        data.nodes.forEach(node => {
                            const nodeEl = document.createElement('div');
                            nodeEl.className = \`node \${node.type}\`;
                            nodeEl.textContent = node.label;
                            nodesContainer.appendChild(nodeEl);
                        });
                        
                        showStatus('📊 Graph structure loaded', 'success');
                    })
                    .catch(error => {
                        showStatus(\`❌ Failed to load graph: \${error.message}\`, 'error');
                    });
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
