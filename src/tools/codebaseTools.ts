import { Tool } from '@langchain/core/tools';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface GitCloneConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  targetDir: string;
}

export class GitCloneTool extends Tool {
  name = 'git-clone';
  description = 'Clones a Git repository to a local directory and checks out a specific branch.';

  private config: GitCloneConfig;

  constructor(config: GitCloneConfig) {
    super();
    this.config = config;
  }

  async _call(): Promise<string> {
    try {
      const { token, owner, repo, branch, targetDir } = this.config;
      const cloneUrl = `https://${token}@github.com/${owner}/${repo}.git`;

      // Create target directory if it doesn't exist
      await fs.mkdir(targetDir, { recursive: true });

      // Use the branch from config
      const baseBranch = branch;

      // Check if directory already exists and has content
      const files = await fs.readdir(targetDir);
      if (files.length > 0) {
        // Directory exists, update remote URL with current token
        await execAsync(`cd "${targetDir}" && git remote set-url origin "${cloneUrl}"`);

        // Fetch latest from origin
        await execAsync(`cd "${targetDir}" && GIT_TERMINAL_PROMPT=0 git fetch origin`);

        // Force checkout base branch (switch if on different branch) and reset to latest
        await execAsync(`cd "${targetDir}" && git checkout -f ${baseBranch} && git reset --hard origin/${baseBranch} && git clean -fd`);
      } else {
        // Clone fresh with base branch
        await execAsync(`GIT_TERMINAL_PROMPT=0 git clone --branch ${baseBranch} "${cloneUrl}" "${targetDir}"`);
      }

      return JSON.stringify({
        success: true,
        path: targetDir,
        branch,
      });
    } catch (error) {
      throw new Error(`Failed to clone repository: ${(error as Error).message}`);
    }
  }
}

export class CodebaseSearchTool extends Tool {
  name = 'codebase-search';
  description = 'Searches for files or content in the cloned codebase. Input should be a search query or file pattern.';

  private codebasePath: string;

  constructor(codebasePath: string) {
    super();
    this.codebasePath = codebasePath;
  }

  async _call(query: string): Promise<string> {
    try {
      // Search for files containing the query
      const { stdout } = await execAsync(
        `cd "${this.codebasePath}" && git grep -n "${query}" || true`
      );

      if (!stdout.trim()) {
        return JSON.stringify({
          found: false,
          message: `No results found for: ${query}`,
        });
      }

      // Parse results
      const lines = stdout.trim().split('\n').slice(0, 50); // Limit to 50 results

      return JSON.stringify({
        found: true,
        results: lines.map(line => {
          const [file, ...rest] = line.split(':');
          return {
            file,
            content: rest.join(':'),
          };
        }),
        totalResults: lines.length,
      });
    } catch (error) {
      throw new Error(`Failed to search codebase: ${(error as Error).message}`);
    }
  }
}

export class CodebaseFileTool extends Tool {
  name = 'codebase-file-read';
  description = 'Reads a specific file from the cloned codebase. Input should be a relative file path.';

  private codebasePath: string;

  constructor(codebasePath: string) {
    super();
    this.codebasePath = codebasePath;
  }

  async _call(filePath: string): Promise<string> {
    try {
      const fullPath = path.join(this.codebasePath, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');

      return JSON.stringify({
        success: true,
        filePath,
        content,
        lines: content.split('\n').length,
      });
    } catch (error) {
      throw new Error(`Failed to read file: ${(error as Error).message}`);
    }
  }
}

export class CodebaseStructureTool extends Tool {
  name = 'codebase-structure';
  description = 'Lists the directory structure of the cloned codebase. Input should be a relative directory path (or empty for root).';

  private codebasePath: string;

  constructor(codebasePath: string) {
    super();
    this.codebasePath = codebasePath;
  }

  async _call(dirPath: string = ''): Promise<string> {
    try {
      const targetPath = path.join(this.codebasePath, dirPath);
      const { stdout } = await execAsync(
        `cd "${targetPath}" && find . -type f -o -type d | head -100`
      );

      const items = stdout.trim().split('\n').filter(item => item !== '.');

      return JSON.stringify({
        success: true,
        path: dirPath || '/',
        items: items.slice(0, 50), // Limit to 50 items
        totalItems: items.length,
      });
    } catch (error) {
      throw new Error(`Failed to list directory: ${(error as Error).message}`);
    }
  }
}
