// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { parse as parseYaml, stringify as stringifyYaml } from "jsr:@std/yaml"

interface FileInput {
  url: string
  path: string // Path where file should be saved in the repo (e.g., "images/photo.jpg")
}

interface RequestBody {
  fileUrls: FileInput[]
  branchName: string
  githubToken: string
  owner?: string // Default: "kannwism"
  repo?: string // Default: "hh-docs"
  baseBranch?: string // Default: "main"
  commitMessage?: string
}

interface MkDocsConfig {
  site_name?: string
  theme?: any
  nav?: Array<any>
  [key: string]: any
}

console.log("GitHub File Upload Function Started")

Deno.serve(async (req) => {
  try {
    // Parse request body
    const {
      fileUrls,
      branchName,
      githubToken,
      owner = "kannwism",
      repo = "hh-docs",
      baseBranch = "main",
      commitMessage = "Add files via edge function"
    }: RequestBody = await req.json()

    // Validate inputs
    if (!fileUrls || !Array.isArray(fileUrls) || fileUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: "fileUrls array is required and must not be empty" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    if (!branchName) {
      return new Response(
        JSON.stringify({ error: "branchName is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    if (!githubToken) {
      return new Response(
        JSON.stringify({ error: "githubToken is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    const githubApiBase = "https://api.github.com"
    const headers = {
      "Authorization": `Bearer ${githubToken}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }

    // Step 1: Get the reference of the base branch
    console.log(`Getting reference for base branch: ${baseBranch}`)
    const refResponse = await fetch(
      `${githubApiBase}/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`,
      { headers }
    )

    if (!refResponse.ok) {
      const error = await refResponse.text()
      return new Response(
        JSON.stringify({ error: `Failed to get base branch reference: ${error}` }),
        { status: refResponse.status, headers: { "Content-Type": "application/json" } }
      )
    }

    const refData = await refResponse.json()
    const baseSha = refData.object.sha

    // Step 2: Create a new branch (or use existing branch)
    console.log(`Creating new branch: ${branchName}`)
    const createBranchResponse = await fetch(
      `${githubApiBase}/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseSha
        })
      }
    )

    if (!createBranchResponse.ok) {
      // If branch already exists (422), that's okay - we'll use it
      if (createBranchResponse.status === 422) {
        console.log(`Branch ${branchName} already exists, using existing branch`)
      } else {
        const error = await createBranchResponse.text()
        return new Response(
          JSON.stringify({ error: `Failed to create branch: ${error}` }),
          { status: createBranchResponse.status, headers: { "Content-Type": "application/json" } }
        )
      }
    } else {
      console.log(`Successfully created branch ${branchName}`)
    }

    // Step 3: Download files from URLs and prepare them for GitHub
    console.log(`Downloading ${fileUrls.length} files...`)
    const filePromises = fileUrls.map(async (fileInput) => {
      try {
        const fileResponse = await fetch(fileInput.url)
        if (!fileResponse.ok) {
          throw new Error(`Failed to download file from ${fileInput.url}: ${fileResponse.statusText}`)
        }

        // Get file content as array buffer
        const arrayBuffer = await fileResponse.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)

        // Convert to base64 for GitHub API
        const base64Content = btoa(String.fromCharCode(...bytes))

        // Convert .mdx to .md for files in docs/ directory
        let finalPath = fileInput.path
        if (finalPath.startsWith('docs/') && finalPath.endsWith('.mdx')) {
          finalPath = finalPath.replace(/\.mdx$/, '.md')
          console.log(`Converting ${fileInput.path} to ${finalPath}`)
        }

        return {
          path: finalPath,
          content: base64Content,
          url: fileInput.url,
          originalPath: fileInput.path
        }
      } catch (error) {
        throw new Error(`Error processing file ${fileInput.url}: ${error.message}`)
      }
    })

    const files = await Promise.all(filePromises)
    console.log(`Successfully downloaded all files`)

    // Step 3.5: Check if any docs files were added, and update mkdocs.yml
    const docsFiles = files.filter(f => f.path.startsWith('docs/') && f.path.endsWith('.md'))
    let mkdocsUpdated = false

    if (docsFiles.length > 0) {
      console.log(`Found ${docsFiles.length} docs files, updating mkdocs.yml...`)

      try {
        // Try to fetch mkdocs.yml from the new branch first, fallback to base branch
        let mkdocsResponse = await fetch(
          `${githubApiBase}/repos/${owner}/${repo}/contents/mkdocs.yml?ref=${branchName}`,
          { headers }
        )

        // If not found on new branch, try base branch
        if (!mkdocsResponse.ok) {
          console.log('mkdocs.yml not found on new branch, trying base branch')
          mkdocsResponse = await fetch(
            `${githubApiBase}/repos/${owner}/${repo}/contents/mkdocs.yml?ref=${baseBranch}`,
            { headers }
          )
        }

        let mkdocsConfig: MkDocsConfig = { site_name: "Documentation" }
        let mkdocsSha: string | undefined

        if (mkdocsResponse.ok) {
          const mkdocsData = await mkdocsResponse.json()
          mkdocsSha = mkdocsData.sha

          // Decode the base64 content
          const mkdocsContent = atob(mkdocsData.content)
          mkdocsConfig = parseYaml(mkdocsContent) as MkDocsConfig
          console.log('Parsed existing mkdocs.yml')
        } else {
          console.log('mkdocs.yml not found, creating new one')
        }

        // Initialize nav array if it doesn't exist
        if (!mkdocsConfig.nav) {
          mkdocsConfig.nav = []
        }

        // Add new docs files to nav
        for (const file of docsFiles) {
          const relativePath = file.path.replace('docs/', '')
          const fileName = relativePath.replace('.md', '')

          // Generate a nice title from the filename
          const title = fileName
            .split(/[-_]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')

          // Check if already in nav
          const existsInNav = mkdocsConfig.nav.some((item: any) => {
            if (typeof item === 'object') {
              return Object.values(item).includes(relativePath)
            }
            return item === relativePath
          })

          if (!existsInNav) {
            mkdocsConfig.nav.push({ [title]: relativePath })
            console.log(`Added ${title} to navigation`)
          }
        }

        // Convert back to YAML and base64
        const updatedYaml = stringifyYaml(mkdocsConfig)
        const updatedYamlBase64 = btoa(updatedYaml)

        // Add mkdocs.yml to files to commit
        files.push({
          path: 'mkdocs.yml',
          content: updatedYamlBase64,
          url: 'internal://mkdocs-update',
          originalPath: 'mkdocs.yml',
          sha: mkdocsSha
        })

        mkdocsUpdated = true
      } catch (error) {
        console.error('Warning: Failed to update mkdocs.yml:', error)
        // Continue anyway - the files will still be added
      }
    }

    // Step 4: Add files to the new branch
    console.log(`Adding files to branch ${branchName}...`)
    const commitPromises = files.map(async (file: any) => {
      // Check if file already exists on the new branch to get its SHA
      let fileSha = file.sha

      if (!fileSha) {
        const checkFileResponse = await fetch(
          `${githubApiBase}/repos/${owner}/${repo}/contents/${file.path}?ref=${branchName}`,
          { headers }
        )

        if (checkFileResponse.ok) {
          const fileData = await checkFileResponse.json()
          fileSha = fileData.sha
          console.log(`File ${file.path} already exists on branch, using SHA: ${fileSha}`)
        }
      }

      const requestBody: any = {
        message: `${commitMessage}: ${file.path}`,
        content: file.content,
        branch: branchName
      }

      // If file has a SHA (i.e., it already exists), include it for update
      if (fileSha) {
        requestBody.sha = fileSha
      }

      const createFileResponse = await fetch(
        `${githubApiBase}/repos/${owner}/${repo}/contents/${file.path}`,
        {
          method: "PUT",
          headers: {
            ...headers,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        }
      )

      if (!createFileResponse.ok) {
        const error = await createFileResponse.text()
        throw new Error(`Failed to add file ${file.path}: ${error}`)
      }

      return await createFileResponse.json()
    })

    const commitResults = await Promise.all(commitPromises)
    console.log(`Successfully committed ${commitResults.length} files`)

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully added ${files.length} files to branch ${branchName}`,
        branch: branchName,
        files: files.map(f => f.path),
        commits: commitResults.map(r => r.commit.sha),
        mkdocsUpdated
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    )

  } catch (error) {
    console.error("Error:", error)
    return new Response(
      JSON.stringify({
        error: error.message || "An unexpected error occurred"
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/add-files-to-repo' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{
      "fileUrls": [
        {
          "url": "https://example.com/text-file.txt",
          "path": "docs/text-file.txt"
        },
        {
          "url": "https://example.com/image.jpg",
          "path": "images/image.jpg"
        }
      ],
      "branchName": "add-new-files",
      "githubToken": "YOUR_GITHUB_TOKEN_HERE"
    }'

  Example adding .mdx docs (will be converted to .md and added to mkdocs.yml nav):

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/add-files-to-repo' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{
      "fileUrls": [
        {
          "url": "https://example.com/getting-started.mdx",
          "path": "docs/getting-started.mdx"
        },
        {
          "url": "https://example.com/api-reference.mdx",
          "path": "docs/api-reference.mdx"
        }
      ],
      "branchName": "add-docs",
      "githubToken": "YOUR_GITHUB_TOKEN_HERE"
    }'

  Example with optional parameters:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/add-files-to-repo' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{
      "fileUrls": [
        {
          "url": "https://example.com/video.mp4",
          "path": "videos/demo.mp4"
        }
      ],
      "branchName": "add-video-files",
      "githubToken": "YOUR_GITHUB_TOKEN_HERE",
      "owner": "kannwism",
      "repo": "hh-docs",
      "baseBranch": "main",
      "commitMessage": "Add demo video"
    }'

  Features:
  - Downloads files from provided URLs (text, images, videos, etc.)
  - Automatically converts .mdx files in docs/ to .md (MkDocs requirement)
  - Updates mkdocs.yml nav section with new documentation files
  - Creates a new branch and commits all changes
  - Works with Vercel auto-deployment

*/
