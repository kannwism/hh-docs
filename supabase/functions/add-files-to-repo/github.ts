export interface GitHubConfig {
  owner: string
  repo: string
  token: string
  apiBase: string
}

export interface GitHubHeaders {
  Authorization: string
  Accept: string
  "X-GitHub-Api-Version": string
}

export class GitHubClient {
  private headers: GitHubHeaders

  constructor(private config: GitHubConfig) {
    this.headers = {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }
  }

  async getBaseBranchRef(branch: string): Promise<string> {
    console.log(`Getting reference for base branch: ${branch}`)
    const response = await fetch(
      `${this.config.apiBase}/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/${branch}`,
      { headers: this.headers }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to get base branch reference: ${error}`)
    }

    const data = await response.json()
    return data.object.sha
  }

  async createOrUseBranch(branchName: string, baseSha: string): Promise<void> {
    console.log(`Creating new branch: ${branchName}`)
    const response = await fetch(
      `${this.config.apiBase}/repos/${this.config.owner}/${this.config.repo}/git/refs`,
      {
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        }),
      }
    )

    if (!response.ok) {
      if (response.status === 422) {
        console.log(`Branch ${branchName} already exists, using existing branch`)
      } else {
        const error = await response.text()
        throw new Error(`Failed to create branch: ${error}`)
      }
    } else {
      console.log(`Successfully created branch ${branchName}`)
    }
  }

  async getFileContent(path: string, ref: string): Promise<{ content: string; sha: string } | null> {
    const response = await fetch(
      `${this.config.apiBase}/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${ref}`,
      { headers: this.headers }
    )

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return {
      content: atob(data.content),
      sha: data.sha,
    }
  }

  async getFileSha(path: string, branch: string): Promise<string | undefined> {
    const response = await fetch(
      `${this.config.apiBase}/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${branch}`,
      { headers: this.headers }
    )

    if (response.ok) {
      const data = await response.json()
      console.log(`File ${path} already exists on branch, using SHA: ${data.sha}`)
      return data.sha
    }

    return undefined
  }

  async commitFile(
    path: string,
    content: string,
    message: string,
    branch: string,
    sha?: string
  ): Promise<any> {
    const requestBody: any = {
      message,
      content,
      branch,
    }

    if (sha) {
      requestBody.sha = sha
    }

    const response = await fetch(
      `${this.config.apiBase}/repos/${this.config.owner}/${this.config.repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          ...this.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to add file ${path}: ${error}`)
    }

    return await response.json()
  }
}
