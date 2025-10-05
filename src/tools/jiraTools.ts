import { Tool } from '@langchain/core/tools';
import axios from 'axios';

export interface JiraConfig {
  host: string;
  email?: string;
  apiToken?: string;
  personalAccessToken?: string;
}

// Helper function to extract plain text from Atlassian Document Format (ADF)
function extractTextFromADF(adf: any): string {
  if (!adf || typeof adf !== 'object') {
    return String(adf || '');
  }

  if (typeof adf === 'string') {
    return adf;
  }

  let text = '';

  // Handle text nodes
  if (adf.type === 'text') {
    return adf.text || '';
  }

  // Recursively process content array
  if (Array.isArray(adf.content)) {
    text = adf.content.map((node: any) => extractTextFromADF(node)).join('');
  }

  // Add newlines for paragraphs and headings
  if (adf.type === 'paragraph' || adf.type === 'heading') {
    text += '\n';
  }

  return text.trim();
}

export interface JiraTicketData {
  found: boolean;
  ticketNumber?: string;
  summary?: string;
  description?: string;
  customDescription?: string; // customfield_10127
  status?: string;
  issueType?: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  message?: string;
}

export class JiraTicketExtractorTool extends Tool {
  name = 'jira-ticket-extractor';
  description = 'Extracts Jira ticket number from a commit message and retrieves ticket details including description. Input should be a commit message string.';

  private jiraHost: string;
  private jiraEmail?: string;
  private jiraToken?: string;
  private personalAccessToken?: string;

  constructor(config: JiraConfig) {
    super();
    this.jiraHost = config.host;
    this.jiraEmail = config.email;
    this.jiraToken = config.apiToken;
    this.personalAccessToken = config.personalAccessToken;
  }

  private extractTicketNumber(commitMessage: string): string | null {
    // Common Jira ticket patterns: PROJ-123, ABC-456, etc.
    const regex = /([A-Z]{2,}-\d+)/g;
    const matches = commitMessage.match(regex);
    return matches ? matches[0] : null;
  }

  async _call(commitMessage: string): Promise<string> {
    try {
      const ticketNumber = this.extractTicketNumber(commitMessage);

      if (!ticketNumber) {
        const result: JiraTicketData = {
          found: false,
          message: 'No Jira ticket number found in commit message',
        };
        return JSON.stringify(result);
      }

      // Fetch issue directly from Jira REST API
      const auth = this.personalAccessToken
        ? { headers: { Authorization: `Bearer ${this.personalAccessToken}` } }
        : {
            auth: {
              username: this.jiraEmail!,
              password: this.jiraToken!,
            },
          };

      const response = await axios.get(
        `${this.jiraHost}/rest/api/3/issue/${ticketNumber}`,
        auth
      );

      const issue = response.data;

      // Extract standard description
      let standardDescription = '';
      if (issue.fields?.description) {
        standardDescription = typeof issue.fields.description === 'string'
          ? issue.fields.description
          : extractTextFromADF(issue.fields.description);
      }

      // Handle custom field - extract plain text from ADF format
      let customDescription = '';
      if (issue.fields.customfield_10127) {
        if (typeof issue.fields.customfield_10127 === 'string') {
          customDescription = issue.fields.customfield_10127;
        } else if (typeof issue.fields.customfield_10127 === 'object') {
          customDescription = extractTextFromADF(issue.fields.customfield_10127);
        }
      }

      // Use custom description as primary description if standard is empty
      const primaryDescription = standardDescription || customDescription || 'No description provided';
      const secondaryDescription = (standardDescription && customDescription) ? customDescription : '';

      const result: JiraTicketData = {
        found: true,
        ticketNumber,
        summary: issue.fields.summary,
        description: primaryDescription,
        customDescription: secondaryDescription || (customDescription ? customDescription : 'No custom description provided'),
        status: issue.fields.status.name,
        issueType: issue.fields.issuetype.name,
        priority: issue.fields.priority?.name,
        assignee: issue.fields.assignee?.displayName,
        reporter: issue.fields.reporter?.displayName,
      };

      return JSON.stringify(result);
    } catch (error: any) {
      if (error.response?.status === 404) {
        const result: JiraTicketData = {
          found: false,
          message: `Jira ticket ${this.extractTicketNumber(commitMessage)} not found`,
        };
        return JSON.stringify(result);
      }

      const result: JiraTicketData = {
        found: false,
        message: `Jira API error: ${error.message}`,
      };
      return JSON.stringify(result);
    }
  }
}
