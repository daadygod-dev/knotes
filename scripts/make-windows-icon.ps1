param(
  [Parameter(Mandatory = $true)]
  [string]$Source,
  [string]$Destination = "public\app-icon.ico",
  [string]$PngDirectory = "public\icons",
  [string]$LockupDestination = "public\og-image.png"
)

Add-Type -AssemblyName System.Drawing

function Resolve-OutputPath([string]$path) {
  if ([System.IO.Path]::IsPathRooted($path)) {
    return [System.IO.Path]::GetFullPath($path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $path))
}

$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$destinationPath = Resolve-OutputPath $Destination
$pngDirectoryPath = Resolve-OutputPath $PngDirectory
$lockupPath = Resolve-OutputPath $LockupDestination
$destinationDirectory = [System.IO.Path]::GetDirectoryName($destinationPath)
[System.IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
[System.IO.Directory]::CreateDirectory($pngDirectoryPath) | Out-Null
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($lockupPath)) | Out-Null

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
$frames = [System.Collections.Generic.List[object]]::new()
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$pngSizes = @(16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024)
$sizes = @($icoSizes + $pngSizes | Sort-Object -Unique)

try {
  foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.DrawImage($sourceImage, 0, 0, $size, $size)

      $stream = [System.IO.MemoryStream]::new()
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $stream.ToArray()
        if ($pngSizes -contains $size) {
          $pngPath = Join-Path $pngDirectoryPath "app-icon-$size.png"
          [System.IO.File]::WriteAllBytes($pngPath, $bytes)
          Write-Output "Wrote $pngPath"
        }
        if ($icoSizes -contains $size) {
          $frames.Add([pscustomobject]@{
            Size = $size
            Bytes = $bytes
          })
        }
      } finally {
        $stream.Dispose()
      }
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
} finally {
  $sourceImage.Dispose()
}

$output = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($output)

try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$frames.Count)

  $offset = 6 + (16 * $frames.Count)
  foreach ($frame in $frames) {
    $dimension = if ($frame.Size -ge 256) { 0 } else { $frame.Size }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frame.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $frame.Bytes.Length
  }

  foreach ($frame in $frames) {
    $writer.Write($frame.Bytes)
  }

  [System.IO.File]::WriteAllBytes($destinationPath, $output.ToArray())
  Write-Output "Wrote $destinationPath with $($frames.Count) sizes."
} finally {
  $writer.Dispose()
  $output.Dispose()
}

function Write-Lockup {
  param(
    [string]$Path,
    [int]$Width,
    [int]$Height,
    [int]$LogoSize,
    [int]$LogoX,
    [int]$LogoY,
    [int]$TextX,
    [int]$TitleSize,
    [int]$SubtitleSize
  )

  $logo = [System.Drawing.Image]::FromFile($sourcePath)
  $canvas = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $titleFont = [System.Drawing.Font]::new("Georgia", $TitleSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $subtitleFont = [System.Drawing.Font]::new("Segoe UI", $SubtitleSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $smallFont = [System.Drawing.Font]::new("Segoe UI", [Math]::Max(15, [int]($SubtitleSize * 0.54)), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $titleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#2e2921"))
  $subtitleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#827868"))
  $accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#9d6e18"))
  $rulePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#c08b2e"), 4)

  try {
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#f3ede2"))
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.DrawImage($logo, $LogoX, $LogoY, $LogoSize, $LogoSize)

    $textBlockHeight = $TitleSize + $SubtitleSize + 62
    $titleY = [int](($Height - $textBlockHeight) / 2)
    $graphics.DrawString("KNOTES", $titleFont, $titleBrush, [System.Single]$TextX, [System.Single]$titleY)
    $graphics.DrawLine($rulePen, $TextX + 4, $titleY + $TitleSize + 8, $TextX + [Math]::Min(410, $Width - $TextX - 70), $titleY + $TitleSize + 8)
    $graphics.DrawString("AI note planner", $subtitleFont, $subtitleBrush, [System.Single]$TextX, [System.Single]($titleY + $TitleSize + 26))
    $graphics.DrawString("LOCAL-FIRST NOTES", $smallFont, $accentBrush, [System.Single]$TextX, [System.Single]($titleY + $TitleSize + $SubtitleSize + 40))

    $canvas.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Wrote $Path"
  } finally {
    $rulePen.Dispose()
    $accentBrush.Dispose()
    $subtitleBrush.Dispose()
    $titleBrush.Dispose()
    $smallFont.Dispose()
    $subtitleFont.Dispose()
    $titleFont.Dispose()
    $graphics.Dispose()
    $canvas.Dispose()
    $logo.Dispose()
  }
}

Write-Lockup -Path $lockupPath -Width 1200 -Height 630 -LogoSize 300 -LogoX 96 -LogoY 165 -TextX 470 -TitleSize 124 -SubtitleSize 36
Write-Lockup -Path (Join-Path ([System.IO.Path]::GetDirectoryName($lockupPath)) "brand-lockup.png") -Width 1200 -Height 320 -LogoSize 216 -LogoX 84 -LogoY 52 -TextX 350 -TitleSize 92 -SubtitleSize 28
