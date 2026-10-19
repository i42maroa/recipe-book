# Regenerate the committed raster brand assets on Windows. No external packages.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetPath = Join-Path $PSScriptRoot '../src/assets/brand'
[System.IO.Directory]::CreateDirectory($assetPath) | Out-Null

function Draw-Mark($graphics, [single]$left, [single]$top, [single]$size) {
    $saved = $graphics.Save()
    $graphics.TranslateTransform($left, $top)
    $graphics.ScaleTransform($size / 64, $size / 64)
    $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#41664c'))
    $leaf = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#c5d6b7'))
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 5)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $shape.AddArc(0, 0, 36, 36, 180, 90)
    $shape.AddArc(28, 0, 36, 36, 270, 90)
    $shape.AddArc(28, 28, 36, 36, 0, 90)
    $shape.AddArc(0, 28, 36, 36, 90, 90)
    $shape.CloseFigure()
    $graphics.FillPath($background, $shape)
    $graphics.DrawBezier($pen, 37, 12, 32, 25, 27, 41, 27, 47)
    $graphics.DrawBezier($pen, 27, 47, 27, 52, 31, 53, 37, 48)
    $leafShape = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $leafShape.AddBezier(37, 26, 37, 16, 44, 13, 51, 13)
    $leafShape.AddBezier(51, 13, 50, 21, 45, 27, 37, 26)
    $leafShape.CloseFigure()
    $graphics.FillPath($leaf, $leafShape)
    $leafShape.Dispose(); $shape.Dispose(); $pen.Dispose(); $leaf.Dispose(); $background.Dispose()
    $graphics.Restore($saved)
}

foreach ($size in @(32, 180)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    Draw-Mark $graphics 0 0 $size
    $name = if ($size -eq 32) { 'favicon-32.png' } else { 'apple-touch-icon.png' }
    $bitmap.Save((Join-Path $assetPath $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose()
}

$bitmap = [System.Drawing.Bitmap]::new(1200, 630)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#f8f8f5'))
$green = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#41664c'))
$muted = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#58685a'))
$titleFont = [System.Drawing.Font]::new('Georgia', 90, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$bodyFont = [System.Drawing.Font]::new('Arial', 34, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$smallFont = [System.Drawing.Font]::new('Arial', 24, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
Draw-Mark $graphics 100 174 220
$graphics.DrawString('Laurel', $titleFont, $green, 375, 164)
$graphics.DrawString('Tu recetario personal', $bodyFont, $muted, 382, 284)
$graphics.DrawString('Ideas para cocinar y disfrutar.', $smallFont, $muted, 384, 354)
$graphics.DrawString('recipe-book-neon-two.vercel.app', $smallFont, $muted, 100, 540)
$bitmap.Save((Join-Path $assetPath 'social-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$smallFont.Dispose(); $bodyFont.Dispose(); $titleFont.Dispose(); $muted.Dispose(); $green.Dispose()
$graphics.Dispose(); $bitmap.Dispose()

# Modern ICO with an embedded 32px PNG frame.
$png = [System.IO.File]::ReadAllBytes((Join-Path $assetPath 'favicon-32.png'))
$stream = [System.IO.File]::Create((Join-Path $assetPath 'favicon.ico'))
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]32); $writer.Write([byte]32); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32)
$writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
$writer.Dispose()
