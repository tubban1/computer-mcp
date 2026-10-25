# OWL LAB Windows UIAutomation read-only adapter.
# No clicks, input, clipboard writes, screenshots, or focus manipulation.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('status','frontmost_app','window_bounds','ui_tree','screenshot')]
  [string]$Action,
  [string]$AppName = '',
  [string]$OutputPath = '',
  [ValidateRange(1,300)]
  [int]$MaxElements = 100
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OwlReadOnlyWindows {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
function Text([object]$value) {
  $s=[string]$value
  if($s.Length -gt 200){$s=$s.Substring(0,200)}
  return [regex]::Replace($s,'[\x00-\x1f\x7f]',' ')
}
function RootWindows {
  $root=[System.Windows.Automation.AutomationElement]::RootElement
  return $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
}
function Foreground {
  $hwnd=[OwlReadOnlyWindows]::GetForegroundWindow()
  if($hwnd -eq [IntPtr]::Zero){throw 'WINDOWS_UIA_FOREGROUND_UNAVAILABLE'}
  $element=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  if($null -eq $element){throw 'WINDOWS_UIA_WINDOW_UNAVAILABLE'}
  return $element
}
function AppFor($element) {
  $pidValue=$element.Current.ProcessId
  try {return Text (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName}
  catch {return 'Unknown'}
}
function FindWindow {
  if(-not $AppName.Trim()){return Foreground}
  foreach($window in (RootWindows)){
    try{
      $process=AppFor $window
      $title=Text $window.Current.Name
      if($process -ieq $AppName -or $title -ieq $AppName){
        return $window
      }
    }catch{}
  }
  throw 'WINDOWS_UIA_APP_NOT_FOUND'
}
function Bounds($element) {
  $r=$element.Current.BoundingRectangle
  if($r.IsEmpty){return @{x=$null;y=$null;width=$null;height=$null}}
  return @{
    x=[math]::Round($r.X)
    y=[math]::Round($r.Y)
    width=[math]::Round($r.Width)
    height=[math]::Round($r.Height)
  }
}
switch($Action){
  'status' {
    @{available=$true;readOnly=$true;backend='windows-uia'} | ConvertTo-Json -Compress -Depth 4
  }
  'frontmost_app' {
    $elem=Foreground
    @{app=(AppFor $elem);bundleIdentifier='';windowTitle=(Text $elem.Current.Name)} |
      ConvertTo-Json -Compress -Depth 4
  }
  'window_bounds' {
    $elem=FindWindow
    $b=Bounds $elem
    @{app=(AppFor $elem);x=$b.x;y=$b.y;width=$b.width;height=$b.height} |
      ConvertTo-Json -Compress -Depth 4
  }
  'screenshot' {
    if(-not $OutputPath -or [IO.Path]::GetExtension($OutputPath).ToLowerInvariant() -ne '.png') {
      throw 'WINDOWS_UIA_SCREENSHOT_PNG_PATH_REQUIRED'
    }
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
    if($bounds.Width -lt 1 -or $bounds.Height -lt 1 -or
       [long]$bounds.Width * [long]$bounds.Height -gt 75000000){
      throw 'WINDOWS_UIA_SCREENSHOT_DIMENSIONS_INVALID'
    }
    $bitmap=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bounds.Size)
      $bitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
    @{path=$OutputPath;width=$bounds.Width;height=$bounds.Height;backend='windows-gdi-readonly'} |
      ConvertTo-Json -Compress -Depth 4
  }
  'ui_tree' {
    $elem=FindWindow
    $queue=New-Object System.Collections.Queue
    $queue.Enqueue(@{element=$elem;depth=0})
    $rows=New-Object System.Collections.ArrayList
    $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
    $limit=[math]::Min(300,$MaxElements)
    while($queue.Count -gt 0 -and $rows.Count -lt $limit){
      $item=$queue.Dequeue()
      $node=$item.element
      try{
        $cur=$node.Current
        $b=Bounds $node
        [void]$rows.Add(@{
          index=$rows.Count+1
          role=(Text $cur.ControlType.ProgrammaticName)
          name=(Text $cur.Name)
          description=''
          value='' # Do not capture passwords or text fields in read-only audit
          x=$b.x;y=$b.y;width=$b.width;height=$b.height
        })
        if($item.depth -lt 10){
          $child=$walker.GetFirstChild($node)
          $visited=0
          while($null -ne $child -and $visited -lt 250){
            $queue.Enqueue(@{element=$child;depth=$item.depth+1})
            $child=$walker.GetNextSibling($child)
            $visited++
          }
        }
      }catch{}
    }
    @{
      app=(AppFor $elem)
      elements=@($rows.ToArray())
      truncated=($queue.Count -gt 0)
    } | ConvertTo-Json -Compress -Depth 6
  }
}
