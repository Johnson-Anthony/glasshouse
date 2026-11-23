# The clipboard as another Windows app sees it and fills it, for the e2e
# clipboard flow (osClipboard in e2e/harness.mjs). Windows PowerShell, -STA.
#   -Read              prints {"cut":bool,"paths":[...],"text":string|null}
#   -FilesFrom <file>  copies the files listed in <file> (UTF-8, one path a
#                      line), as Explorer's Copy does; with -Cut, as its Cut
#   -Text <text>       copies text, as Notepad does
param(
  [switch]$Read,
  [string]$FilesFrom,
  [switch]$Cut,
  [string]$Text
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

# Explorer's DROPEFFECT values: a cut prefers a move, a copy a copy or a link.
$Move = 2
$CopyOrLink = 5

if ($Read) {
  $data = [System.Windows.Forms.Clipboard]::GetDataObject()
  $paths = @()
  $isCut = $false
  $textOut = $null
  if ($null -ne $data) {
    if ($data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
      $paths = @($data.GetData([System.Windows.Forms.DataFormats]::FileDrop))
      $effect = $data.GetData("Preferred DropEffect")
      if ($effect -is [System.IO.Stream]) {
        $bytes = New-Object byte[] 4
        [void]$effect.Read($bytes, 0, 4)
        $isCut = ([System.BitConverter]::ToInt32($bytes, 0) -band $Move) -ne 0
      }
    }
    if ($data.GetDataPresent([System.Windows.Forms.DataFormats]::UnicodeText)) {
      $textOut = [string]$data.GetData([System.Windows.Forms.DataFormats]::UnicodeText)
    }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ cut = $isCut; paths = [string[]]$paths; text = $textOut }))
  exit 0
}

if ($FilesFrom) {
  $files = New-Object System.Collections.Specialized.StringCollection
  foreach ($line in [System.IO.File]::ReadAllLines($FilesFrom, [System.Text.Encoding]::UTF8)) {
    if ($line) { [void]$files.Add($line) }
  }
  if ($files.Count -eq 0) { throw "no paths in $FilesFrom" }
  $data = New-Object System.Windows.Forms.DataObject
  $data.SetFileDropList($files)
  $effect = if ($Cut) { $Move } else { $CopyOrLink }
  $stream = New-Object System.IO.MemoryStream (, [System.BitConverter]::GetBytes([int]$effect))
  $data.SetData("Preferred DropEffect", $stream)
  # Kept on the clipboard after this process ends.
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
  exit 0
}

if ($PSBoundParameters.ContainsKey("Text")) {
  [System.Windows.Forms.Clipboard]::SetText($Text)
  exit 0
}

throw "nothing to do: pass -Read, -FilesFrom or -Text"
