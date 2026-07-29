#!/bin/sh
# SDD에 정의한 에러가 화면 문서 어딘가에 나오는지 확인한다.
#
# 잡는 것   — SDD에 E3를 추가하고 화면 문서에 반영을 안 한 경우
# 못 잡는 것 — 반영은 했는데 엉뚱한 화면에 적은 경우 (PR 리뷰에서 사람이 본다)
#
# 실행: sh docs/check-errors.sh   (리포 루트에서)
fail=0
for sdd in docs/sdd/SDD-*.md; do
  [ -e "$sdd" ] || continue          # SDD가 아직 하나도 없을 때 glob이 안 풀리는 것 방지
  num=$(basename "$sdd" | cut -d- -f2)
  for e in $(grep -o '^E[0-9]*' "$sdd"); do
    grep -rq "SDD-$num $e" docs/screens/ || { echo "미반영: SDD-$num $e ($sdd)"; fail=1; }
  done
done
exit $fail
