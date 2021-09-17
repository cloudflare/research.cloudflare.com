#! /bin/bash

SCRIPT_DIR=$(dirname $(pwd -P $0)/${0#\.\/})
pushd $SCRIPT_DIR > /dev/null

# make sure that we have a picture for all people
for path in ../people/*.md; do

  #echo $path
  person=$(basename "$path" .md)
  #echo $person
  image_path="../img/people/${person}.jpg"
  #echo $image_path

  # if the image does not exist and this .md file contains a 'position' (is a profile)
  if [ ! -f "${image_path}" ] && grep -q 'position' "$path"; then
     echo "No image found for $person. Trying to download using 'image' frontmatter in ${path}"
     item=$(grep 'image' "$path")
     url=${item#image: }
     echo "Trying $url"
     curl $url -o ${image_path}.original
     convert ${image_path}.original -resize '400X400^' -gravity center -extent '400x400' ${image_path}
  fi

done

popd > /dev/null
