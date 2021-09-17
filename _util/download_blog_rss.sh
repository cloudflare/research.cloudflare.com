#! /bin/bash

SCRIPT_DIR=$(dirname $(pwd -P $0)/${0#\.\/})
pushd $SCRIPT_DIR > /dev/null

#echo $PWD
#echo $PWD
#echo $PWD

curl 'https://blog.cloudflare.com/tag/research/rss/' -o ../rss.xml

#ls -l ../rss.xml

popd > /dev/null
