param([string]$Path)
$t = Get-Content $Path -Raw | ConvertFrom-Json
function Lum($hex){ $h=$hex.TrimStart('#'); $c=@(0,2,4)|%{ $v=[Convert]::ToInt32($h.Substring($_,2),16)/255; if($v -le 0.03928){$v/12.92}else{[Math]::Pow(($v+0.055)/1.055,2.4)} }; 0.2126*$c[0]+0.7152*$c[1]+0.0722*$c[2] }
$fail=0
foreach($p in $t.pairs){ $a=$t.color.($p[0]); $b=$t.color.($p[1]); $la=Lum $a; $lb=Lum $b; $r=([Math]::Max($la,$lb)+0.05)/([Math]::Min($la,$lb)+0.05); $min= if($p.Count -gt 2){3}else{4.5}; $ok= $r -ge $min; if(-not $ok){$fail++}; "{0,-14} on {1,-12} {2,5:N2}  need {3}  {4}" -f $p[0],$p[1],$r,$min,($(if($ok){'PASS'}else{'FAIL'})) }
"failures: $fail"
