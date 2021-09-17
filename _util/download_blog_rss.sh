#! /bin/bash

SCRIPT_DIR=$(dirname $(pwd -P $0)/${0#\.\/})
pushd $SCRIPT_DIR > /dev/null

curl 'https://blog.cloudflare.com/tag/research/rss/' -o ../rss.xml


popd > /dev/null
