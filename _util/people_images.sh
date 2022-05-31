#! /bin/bash

SCRIPT_DIR=$(dirname $(pwd -P $0)/${0#\.\/})
pushd $SCRIPT_DIR > /dev/null

PEOPLE_PATHS=../people/*.md
INTERN_PATHS=../outreach/academic-programs/interns/*.md

# all profile paths
PROFILE_PATHS="$PEOPLE_PATHS $INTERN_PATHS"

# make sure that we have a picture for all people
for path in $PROFILE_PATHS; do

  #echo $path
  person=$(basename "$path" .md)
  #echo $person
  image_path="../img/people/${person}.jpg"
  #echo $image_path

  # if the image does not exist and this .md file contains a 'position' (is a profile)
  if [ ! -f "${image_path}" ] && grep -q 'position' "$path"; then
    echo "No image found for: $person"
    echo "Looking for an original image at: ${image_path}.original"

    if [ -f "${image_path}.original" ]; then
      echo "Converting '${image_path}.jpg.original'"
      convert ${image_path}.original -resize '400X400^' -gravity center -extent '400x400' ${image_path}
    else
      echo "'${image_path}.original not found. Please add and retry."
      echo
      exit 1
    fi

 fi

done

popd > /dev/null
