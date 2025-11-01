// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { GitHubClient } from "./github.ts"
import { downloadAndProcessFiles, getDocsFiles, type FileInput } from "./files.ts"
import { updateMkDocsConfig } from "./mkdocs.ts"

interface RequestBody {
  fileUrls: FileInput[]
  branchName: string
  githubToken: string
  owner?: string
  repo?: string
  baseBranch?: string
  commitMessage?: string
}

console.log("GitHub File Upload Function Started")

Deno.serve(async (req) => {
  try {
    // Parse and validate request
    const {
      fileUrls,
      branchName,
      githubToken,
      owner = "kannwism",
      repo = "hh-docs",
      baseBranch = "main",
      commitMessage = "Add files via edge function",
    }: RequestBody = await req.json()

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

    // Initialize GitHub client
    const github = new GitHubClient({
      owner,
      repo,
      token: githubToken,
      apiBase: "https://api.github.com",
    })

    // Get base branch and create/use new branch
    const baseSha = await github.getBaseBranchRef(baseBranch)
    await github.createOrUseBranch(branchName, baseSha)

    // Download and process files
    const files = await downloadAndProcessFiles(fileUrls)

    // Update mkdocs.yml if needed
    const docsFiles = getDocsFiles(files)
    const mkdocsFile = await updateMkDocsConfig(github, docsFiles, branchName, baseBranch)

    if (mkdocsFile) {
      files.push(mkdocsFile)
    }

    // Commit all files
    console.log(`Adding ${files.length} files to branch ${branchName}...`)
    const commitPromises = files.map(async (file) => {
      // Check if file already exists on branch
      const fileSha = file.sha || (await github.getFileSha(file.path, branchName))

      return await github.commitFile(
        file.path,
        file.content,
        `${commitMessage}: ${file.path}`,
        branchName,
        fileSha
      )
    })

    const commitResults = await Promise.all(commitPromises)
    console.log(`Successfully committed ${commitResults.length} files`)

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully added ${files.length} files to branch ${branchName}`,
        branch: branchName,
        files: files.map((f) => f.path),
        commits: commitResults.map((r) => r.commit.sha),
        mkdocsUpdated: !!mkdocsFile,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )
  } catch (error) {
    console.error("Error:", error)
    return new Response(
      JSON.stringify({
        error: error.message || "An unexpected error occurred",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
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
