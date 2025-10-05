import { Tool } from '@langchain/core/tools';
import { Octokit } from '@octokit/rest';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

export interface CommitData {
  hash: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface FileChange {
  filename: string;
  additions: number;
  deletions: number;
  changes: number;
}

export interface CommitDiffData {
  hash: string;
  message: string;
  diff: string;
  filesChanged: FileChange[];
}

export class GitHubCommitListenerTool extends Tool {
  name = 'github-commit-listener';
  description = 'Retrieves the latest commit from a GitHub repository. Returns commit hash, message, author, and URL.';

  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: GitHubConfig) {
    super();
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
  }

  async _call(): Promise<string> {
    try {
      const { data: commits } = await this.octokit.repos.listCommits({
        owner: this.owner,
        repo: this.repo,
        sha: 'main', // Filter for main branch only
        per_page: 1,
      });

      if (commits.length === 0) {
        throw new Error('No commits found');
      }

      const commit = commits[0];
      const result: CommitData = {
        hash: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author?.name || 'Unknown',
        date: commit.commit.author?.date || '',
        url: commit.html_url,
      };

      return JSON.stringify(result);
    } catch (error) {
      throw new Error(`GitHub API error: ${(error as Error).message}`);
    }
  }
}

export class GitHubCommitDiffTool extends Tool {
  name = 'github-commit-diff';
  description = 'Retrieves the diff for a specific commit hash. Input should be a commit hash string.';

  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: GitHubConfig) {
    super();
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
  }

  async _call(commitHash: string): Promise<string> {
    try {
      // Get commit details with diff
      const { data: commit } = await this.octokit.repos.getCommit({
        owner: this.owner,
        repo: this.repo,
        ref: commitHash,
        mediaType: {
          format: 'diff',
        },
      });

      // Also get the structured commit data
      const { data: commitData } = await this.octokit.repos.getCommit({
        owner: this.owner,
        repo: this.repo,
        ref: commitHash,
      });

      const result: CommitDiffData = {
        hash: commitHash,
        message: commitData.commit.message,
        diff: commit as unknown as string,
        filesChanged: (commitData.files || []).map(f => ({
          filename: f.filename,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
        })),
      };

      return JSON.stringify(result);
    } catch (error) {
      throw new Error(`Failed to retrieve commit diff: ${(error as Error).message}`);
    }
  }
}
