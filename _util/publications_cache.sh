#! /bin/bash

SCRIPT_DIR=$(dirname $(pwd -P $0)/${0#\.\/})
pushd $SCRIPT_DIR > /dev/null

# try to upload all pdf.original files in _build as publications
for pdf in ../_build/*.pdf.original; do

  filename=$(basename "$pdf" .original)
  echo "Processing $pdf -> https://files.research.cloudflare.com/publication/${filename}"

  # check that we can post files, if not try to authenticate
  echo "$(date +%Y-%m-%d" "%H:%M:%S)" > ../_build/updated.txt
  OUTPUT=$(cloudflared access curl -ar https://files.research.cloudflare.com/post/publication/updated.txt -X POST --data-binary @../_build/updated.txt 2>&1)

  if [[ "$OUTPUT" =~ "<access application>" ]]; then
    cloudflared access login https://files.research.cloudflare.com/post/
  fi

  cloudflared access curl https://files.research.cloudflare.com/post/publication/${filename} -X POST --data-binary @${pdf}

done

popd > /dev/null
