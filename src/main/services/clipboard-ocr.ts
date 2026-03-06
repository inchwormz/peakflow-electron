/**
 * clipboard-ocr.ts — OCR for image clips using Windows native OCR (WinRT).
 *
 * Invokes PowerShell with Add-Type to load Windows.Media.Ocr via WinRT.
 * Only works on Windows 10 1809+ (build 17763+). Falls back gracefully.
 */

import { execFile } from 'child_process'
import { existsSync } from 'fs'

// ─── OCR via Windows Runtime ────────────────────────────────────────────────

/**
 * Run OCR on an image file using Windows native OCR engine.
 * Returns extracted text or null if OCR fails/unavailable.
 */
export function runOcr(imagePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!existsSync(imagePath)) {
      resolve(null)
      return
    }

    // PowerShell script using Windows.Media.Ocr (WinRT)
    // Uses String.Format instead of C# string interpolation to avoid
    // PowerShell here-string $ expansion issues (see CLAUDE.md gotchas)
    const psScript = `
try {
  Add-Type -AssemblyName 'System.Runtime.WindowsRuntime'

  # Helper to await WinRT async operations
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1
  })[0]
  Function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }

  # Load the image file
  $file = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]::GetFileFromPathAsync('${imagePath.replace(/\\/g, '\\\\').replace(/'/g, "''")}')
  $storageFile = Await $file ([Windows.Storage.StorageFile])

  $stream = $storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)
  $fileStream = Await $stream ([Windows.Storage.Streams.IRandomAccessStream])

  # Decode bitmap
  $decoder = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]::CreateAsync($fileStream)
  $bitmapDecoder = Await $decoder ([Windows.Graphics.Imaging.BitmapDecoder])

  $softwareBitmap = Await ($bitmapDecoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  # Create OCR engine (default language)
  $ocrEngine = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]::TryCreateFromUserProfileLanguages()

  if ($ocrEngine -eq $null) {
    [Console]::Out.WriteLine('')
    exit 0
  }

  # Run OCR
  $ocrResult = Await ($ocrEngine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])

  [Console]::Out.WriteLine($ocrResult.Text)
} catch {
  [Console]::Error.WriteLine([String]::Format("OCR error: {0}", $_.Exception.Message))
  [Console]::Out.WriteLine('')
}
`

    execFile(
      'powershell.exe',
      ['-ExecutionPolicy', 'RemoteSigned', '-NoProfile', '-Command', psScript],
      { timeout: 15000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          console.warn('[QuickBoard] OCR failed:', error.message)
          resolve(null)
          return
        }
        if (stderr) {
          console.warn('[QuickBoard] OCR stderr:', stderr.trim())
        }
        const text = stdout.trim()
        resolve(text.length > 0 ? text : null)
      }
    )
  })
}
