param([switch]$SmokeTest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$root = Split-Path $PSScriptRoot -Parent
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { [System.Windows.Forms.MessageBox]::Show('Node.js 22 이상을 설치한 뒤 다시 실행하세요. docs/USAGE.md를 참고하세요.'); exit 1 }
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Threads 텍스트 보관 - 실행 가능한 초안'
$form.ClientSize = New-Object System.Drawing.Size(690,490)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Malgun Gothic',10)
$form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false
function Label($text,$x,$y,$w,$h) {
  $c = New-Object System.Windows.Forms.Label; $c.Text=$text; $c.SetBounds($x,$y,$w,$h); $form.Controls.Add($c); return $c
}
function Button($text,$x,$y,$w) {
  $c = New-Object System.Windows.Forms.Button; $c.Text=$text; $c.SetBounds($x,$y,$w,34); $form.Controls.Add($c); return $c
}
$null = Label '데모는 합성 데이터입니다. 실제 Threads 계정 전체 백업은 지원하지 않습니다.' 20 15 650 45
$null = Label '계정명' 20 70 100 25
$account = New-Object System.Windows.Forms.TextBox; $account.SetBounds(125,67,360,28); $account.Text='demo_account'; $form.Controls.Add($account)
$null = Label '결과 폴더' 20 110 100 25
$folder = New-Object System.Windows.Forms.TextBox; $folder.SetBounds(125,107,425,28); $folder.Text=Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ThreadsArchive'; $form.Controls.Add($folder)
$browse = Button '선택' 565 104 100
$browse.Add_Click({ $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if($dialog.ShowDialog() -eq 'OK') {$folder.Text=$dialog.SelectedPath}; $dialog.Dispose() })
$null = Label '수집 모드' 20 153 100 25
$mode = New-Object System.Windows.Forms.ComboBox; $mode.SetBounds(125,150,540,30); $mode.DropDownStyle='DropDownList'
$mode.Items.AddRange(@('로컬 데모 - fixture 전체','로컬 데모 - 일부 실패','실제 Threads - 미구현 사유 보고')); $mode.SelectedIndex=0; $form.Controls.Add($mode)
$start = Button '수집 시작 / 이어받기' 20 198 220
$stop = Button '중지' 255 198 100; $stop.Enabled=$false
$chrome = Button '전용 Chrome 수동 확인' 370 198 295
$null = Label '같은 계정·모드·폴더로 시작하면 저장된 위치부터 이어받습니다.' 20 245 650 28
$counts = Label '발견 0 / 저장 0' 20 280 650 28
$status = Label '준비됨' 20 316 650 130
$script:worker=$null; $script:closing=$false; $script:runDir=$null; $script:progress=$null; $script:stopFile=$null
$timer=New-Object System.Windows.Forms.Timer; $timer.Interval=150
$start.Add_Click({
  try {
    if($account.Text -notmatch '^@?[A-Za-z0-9_][A-Za-z0-9_.]{0,29}$') {throw '유효한 계정명을 입력하세요.'}
    if([string]::IsNullOrWhiteSpace($folder.Text)) {throw '결과 폴더를 선택하세요.'}
    $script:runDir=Join-Path ([IO.Path]::GetTempPath()) ('threads-run-'+[guid]::NewGuid().ToString())
    $null=New-Item -ItemType Directory -Path $script:runDir
    $script:progress=Join-Path $script:runDir 'progress.json'; $script:stopFile=Join-Path $script:runDir 'stop'
    # ProcessStartInfo launches Node directly, with no command shell interpolation.
    $values=@((Join-Path $PSScriptRoot 'cli.mjs'),'--account',$account.Text,'--output',$folder.Text,'--source',@('demo','partial','live')[$mode.SelectedIndex],'--progress',$script:progress,'--stop',$script:stopFile)
    $quoted=@($values | ForEach-Object {if($_.Contains('"')){throw '입력에 큰따옴표를 사용할 수 없습니다.'}; '"'+[regex]::Replace($_,'(\\+)$','$1$1')+'"'})
    $info=New-Object Diagnostics.ProcessStartInfo; $info.FileName=$node.Source; $info.Arguments=$quoted -join ' '; $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $script:worker=[Diagnostics.Process]::Start($info)
    $start.Enabled=$false; $stop.Enabled=$true; $account.Enabled=$false; $folder.Enabled=$false; $mode.Enabled=$false; $browse.Enabled=$false; $chrome.Enabled=$false
    $status.Text='수집 준비 중'; $counts.Text='발견 0 / 저장 0'; $timer.Start()
  } catch { $status.Text='불완전: '+$_.Exception.Message }
})
$stop.Add_Click({ if($script:worker) {[IO.File]::WriteAllText($script:stopFile,'stop'); $status.Text='중지 요청됨 - 현재 상태 저장 중'} })
$timer.Add_Tick({
  try {
    if(Test-Path -LiteralPath $script:progress) {
      $r=Get-Content -Raw -Encoding UTF8 -LiteralPath $script:progress | ConvertFrom-Json
      $counts.Text='발견 '+$r.discoveredCount+' / 저장 '+$r.savedCount
      $status.Text=$r.finalStatus+' - '+$r.completionScope
      if($r.message) {$status.Text+=': '+$r.message}
      if($r.failedItems) {$status.Text+="`r`n"+(($r.failedItems | Select-Object -First 2 | ForEach-Object {$_.reason}) -join "`r`n")}
    }
    if($script:worker.HasExited) {
      $timer.Stop()
      # Re-read after exit to avoid mistaking an earlier timer snapshot for the final result.
      if(Test-Path -LiteralPath $script:progress) {
        $r=Get-Content -Raw -Encoding UTF8 -LiteralPath $script:progress | ConvertFrom-Json
        $counts.Text='발견 '+$r.discoveredCount+' / 저장 '+$r.savedCount
        $status.Text=$r.finalStatus+' - '+$r.completionScope
        if($r.message){$status.Text+=': '+$r.message}
        if($r.failedItems){$status.Text+="`r`n"+(($r.failedItems | Select-Object -First 2 | ForEach-Object {$_.reason}) -join "`r`n")}
      }
      if($script:worker.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $script:progress)) {$status.Text='불완전 - 실행 또는 저장 오류. '+$status.Text}
      elseif($r.finalStatus -eq '진행 중') {$status.Text='불완전 - 비정상 종료. 같은 폴더에서 이어받으세요.'}
      $script:worker.Dispose(); $script:worker=$null
      $start.Enabled=$true; $stop.Enabled=$false; $account.Enabled=$true; $folder.Enabled=$true; $mode.Enabled=$true; $browse.Enabled=$true; $chrome.Enabled=$true
      if($script:closing) {$form.Close()}
    }
  } catch {$status.Text='진행 상태 읽기 오류: '+$_.Exception.Message}
})
$chrome.Add_Click({
  try {
    if($account.Text -notmatch '^@?[A-Za-z0-9_][A-Za-z0-9_.]{0,29}$') {throw '유효한 계정명을 입력하세요.'}
    $paths=@((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),(Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
    $exe=$paths | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
    if(-not $exe){throw 'Chrome 설치를 찾지 못했습니다.'}
    $profile=Join-Path $env:LOCALAPPDATA ('ThreadsArchive\BrowserProfiles\'+[guid]::NewGuid().ToString())
    $info=New-Object Diagnostics.ProcessStartInfo; $info.FileName=$exe; $info.Arguments='--user-data-dir="'+$profile+'" --no-first-run --no-default-browser-check --new-window "https://www.threads.com/@'+$account.Text.TrimStart('@')+'"'; $info.UseShellExecute=$false
    $null=[Diagnostics.Process]::Start($info)
    $status.Text='새 비로그인 전용 Chrome을 열었습니다. 수동 확인 전용이며 내용을 수집하지 않습니다. 로그인 자동화는 없습니다.'
  } catch {$status.Text=$_.Exception.Message}
})
$form.Add_FormClosing({param($sender,$eventArgs) if($script:worker -and -not $script:worker.HasExited){$eventArgs.Cancel=$true; $script:closing=$true; [IO.File]::WriteAllText($script:stopFile,'stop'); $status.Text='종료 전 상태 저장 중'}})
if($SmokeTest) {
  $folder.Text=Join-Path $root ('output\gui-smoke-'+[guid]::NewGuid().ToString())
  $form.Show(); [System.Windows.Forms.Application]::DoEvents()
  if($form.Controls.Count -lt 10){throw 'GUI controls missing'}
  function PumpUntil($condition) {
    $deadline=[DateTime]::UtcNow.AddSeconds(25)
    while(-not (& $condition)) {
      [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 30
      if([DateTime]::UtcNow -gt $deadline){throw ('GUI smoke timeout: '+$status.Text)}
    }
  }
  $start.PerformClick()
  PumpUntil { (Test-Path -LiteralPath $script:progress) -and ((Get-Content -Raw -Encoding UTF8 -LiteralPath $script:progress | ConvertFrom-Json).discoveredCount -ge 1) }
  $stop.PerformClick(); PumpUntil { $null -eq $script:worker }
  if($status.Text -notmatch '^중단'){throw ('Stop failed: '+$status.Text)}
  $start.PerformClick(); PumpUntil { $null -eq $script:worker }
  if($status.Text -notmatch '^완료'){throw ('Resume failed: '+$status.Text)}
  if($counts.Text -ne '발견 9 / 저장 6'){throw ('Counters failed: '+$counts.Text)}
  $bitmap=New-Object Drawing.Bitmap($form.Width,$form.Height)
  $form.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)))
  $bitmap.Save((Join-Path $folder.Text 'gui-demo.png')); $bitmap.Dispose()
  $folder.Text=Join-Path $folder.Text 'partial'; $mode.SelectedIndex=1
  $start.PerformClick(); PumpUntil { $null -eq $script:worker }
  if($status.Text -notmatch '^불완전'){throw ('Partial failed: '+$status.Text)}
  $folder.Text=Join-Path $folder.Text 'live'; $mode.SelectedIndex=2
  $start.PerformClick(); PumpUntil { $null -eq $script:worker }
  if($status.Text -notmatch '^불완전'){throw ('Live scaffold failed: '+$status.Text)}
  $form.Close(); $timer.Dispose(); $form.Dispose()
  Write-Output 'GUI smoke passed: initialize, start, stop, resume, counters, complete, partial, live scaffold'
  exit 0
}
[void]$form.ShowDialog(); $timer.Dispose(); $form.Dispose()
