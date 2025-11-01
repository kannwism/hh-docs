export interface FileInput {
  url: string
  path: string
}

export interface ProcessedFile {
  path: string
  content: string
  url: string
  originalPath: string
  sha?: string
}

export async function downloadAndProcessFiles(fileInputs: FileInput[]): Promise<ProcessedFile[]> {
  console.log(`Downloading ${fileInputs.length} files...`)

  const filePromises = fileInputs.map(async (fileInput) => {
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
      if (finalPath.startsWith("docs/") && finalPath.endsWith(".mdx")) {
        finalPath = finalPath.replace(/\.mdx$/, ".md")
        console.log(`Converting ${fileInput.path} to ${finalPath}`)
      }

      return {
        path: finalPath,
        content: base64Content,
        url: fileInput.url,
        originalPath: fileInput.path,
      }
    } catch (error) {
      throw new Error(`Error processing file ${fileInput.url}: ${error.message}`)
    }
  })

  const files = await Promise.all(filePromises)
  console.log(`Successfully downloaded all files`)

  return files
}

export function getDocsFiles(files: ProcessedFile[]): ProcessedFile[] {
  return files.filter((f) => f.path.startsWith("docs/") && f.path.endsWith(".md"))
}
