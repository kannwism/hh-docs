import { parse as parseYaml, stringify as stringifyYaml } from "jsr:@std/yaml"
import type { GitHubClient } from "./github.ts"
import type { ProcessedFile } from "./files.ts"

export interface MkDocsConfig {
  site_name?: string
  theme?: any
  nav?: Array<any>
  [key: string]: any
}

export async function updateMkDocsConfig(
  github: GitHubClient,
  docsFiles: ProcessedFile[],
  branchName: string,
  baseBranch: string
): Promise<ProcessedFile | null> {
  if (docsFiles.length === 0) {
    return null
  }

  console.log(`Found ${docsFiles.length} docs files, updating mkdocs.yml...`)

  try {
    // Try to fetch mkdocs.yml from the new branch first, fallback to base branch
    let fileData = await github.getFileContent("mkdocs.yml", branchName)

    if (!fileData) {
      console.log("mkdocs.yml not found on new branch, trying base branch")
      fileData = await github.getFileContent("mkdocs.yml", baseBranch)
    }

    let mkdocsConfig: MkDocsConfig = { site_name: "Documentation" }
    let mkdocsSha: string | undefined

    if (fileData) {
      mkdocsConfig = parseYaml(fileData.content) as MkDocsConfig
      mkdocsSha = fileData.sha
      console.log("Parsed existing mkdocs.yml")
    } else {
      console.log("mkdocs.yml not found, creating new one")
    }

    // Initialize nav array if it doesn't exist
    if (!mkdocsConfig.nav) {
      mkdocsConfig.nav = []
    }

    // Add new docs files to nav
    for (const file of docsFiles) {
      const relativePath = file.path.replace("docs/", "")
      const fileName = relativePath.replace(".md", "")

      // Generate a nice title from the filename
      const title = fileName
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")

      // Check if already in nav
      const existsInNav = mkdocsConfig.nav.some((item: any) => {
        if (typeof item === "object") {
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

    return {
      path: "mkdocs.yml",
      content: updatedYamlBase64,
      url: "internal://mkdocs-update",
      originalPath: "mkdocs.yml",
      sha: mkdocsSha,
    }
  } catch (error) {
    console.error("Warning: Failed to update mkdocs.yml:", error)
    // Continue anyway - the files will still be added
    return null
  }
}
