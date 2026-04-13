# Build-VSIX.ps1 — Create toolpilot-1.0.0.vsix without npm/vsce
$ErrorActionPreference = "Stop"
$root = "c:\Users\zvc1fnv\source\toolpilot"
$vsixDir = "$env:TEMP\toolpilot-vsix"
$vsixOut = "$root\toolpilot-1.0.0.vsix"

# Clean
if (Test-Path $vsixDir) { Remove-Item $vsixDir -Recurse -Force }
if (Test-Path $vsixOut) { Remove-Item $vsixOut -Force }

# Create structure
New-Item -ItemType Directory "$vsixDir\extension\examples" -Force | Out-Null

# Copy extension files
Copy-Item "$root\extension.js"    "$vsixDir\extension\"
Copy-Item "$root\package.json"    "$vsixDir\extension\"
Copy-Item "$root\README.md"       "$vsixDir\extension\"
Copy-Item "$root\CHANGELOG.md"    "$vsixDir\extension\"
Copy-Item "$root\LICENSE"         "$vsixDir\extension\"
Copy-Item "$root\examples\*"     "$vsixDir\extension\examples\" -Recurse

# [Content_Types].xml
$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".py" ContentType="text/x-python" />
  <Default Extension=".txt" ContentType="text/plain" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
'@
[System.IO.File]::WriteAllText("$vsixDir\[Content_Types].xml", $contentTypes, [System.Text.Encoding]::UTF8)

# extension.vsixmanifest
$manifest = @'
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="toolpilot" Version="1.0.0" Publisher="rnamburi" />
    <DisplayName>ToolPilot</DisplayName>
    <Description xml:space="preserve">Run autonomous AI agent loops with any external tools — powered by your Copilot subscription. No API keys needed.</Description>
    <Tags>copilot,agent,autonomous,tool-calling,automation,ai-agent</Tags>
    <Categories>AI,Other</Categories>
    <License>extension/LICENSE</License>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.95.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
'@
$manifest | Set-Content "$vsixDir\extension.vsixmanifest" -Encoding UTF8

# Create .vsix (zip renamed)
$zipPath = "$root\toolpilot-1.0.0.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$vsixDir\*" -DestinationPath $zipPath -Force
Rename-Item $zipPath $vsixOut

Write-Host "Created: $vsixOut"
Get-Item $vsixOut | Select-Object Name, @{N="SizeKB";E={[math]::Round($_.Length/1024,1)}}
