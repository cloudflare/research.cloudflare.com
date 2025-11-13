const fs = require("fs");
const path = require("path");

const yaml = require("js-yaml");

async function download(url, destination) {
  console.log("downloading url '" + url + "' to '" + destination + "'");

  const response = await fetch(url);
  const content = await response.text();

  fs.writeFileSync(destination, content);
}

function generatePublications() {
  let publications = [];

  try {
    const files = fs.readdirSync("publications/");

    let content = "";
    for (const file of files) {
      //console.log( file )
      //console.log( path.parse( file ) )

      if (typeof file !== "undefined" && path.parse(file).ext == ".md") {
        let slug = path.parse(file).name;
        content = fs.readFileSync("publications/" + file, "utf8");

        let front = content.substr(4, content.indexOf("---", 4) - 4);
        //console.log( front )

        frontMatter = yaml.load(front);
        //console.log( frontMatter )
        frontMatter.slug = slug;

        if (frontMatter.year == undefined || frontMatter.year == "")
          frontMatter.year = "pending";

        publications.push(frontMatter);
      }
    }
  } catch (err) {
    console.error(err);
  }

  return publications;
}

result = {};

async function main() {
  // parse the front matter and add to 'profiles'
  let publications = generatePublications();
  //console.log( publications );

  // sort without year first and then newest to oldest years
  let ordered = publications.sort((a, b) => {
    if (typeof a.year == "number" && typeof b.year == "number")
      return b.year - a.year;
    else if (a.year == "pending" && b.year == null) return 0;
    else if (a.year == "pending") return -1;
    else if (b.year == "pending") return 1;
  });

  let author_publications = {};
  for (const publication of ordered) {
    for (const author of publication.authors) {
      //console.log( author )
      if (author_publications[author] === undefined)
        author_publications[author] = [];
      author_publications[author].push(publication.slug);
    }
  }

  // get list of cached publications for which we can offer a 'read' link
  await download(
    "https://files.research.cloudflare.com/list/publication/",
    "_build/publications_cached.json"
  );
  let cached_list = JSON.parse(
    fs.readFileSync("_build/publications_cached.json")
  );

  result[ordered] = ordered;

  let publication_years = [];
  let publication_interests = [];

  for (publication of publications) {
    //console.log( cached_list )

    // add a local property to indicate whether we have a
    publication.local = cached_list.includes(
      "/publication/" + publication.slug + ".pdf"
    );
    if (!publication.local) {
      console.log(
        " - " +
          publication.slug +
          " is missing a cached copy. Add '_build/" +
          publication.slug +
          ".pdf.original'"
      );
    }

    result[publication.slug] = publication;

    if (!publication_years.includes(publication.year))
      publication_years.push(publication.year);

    if (publication.related_interests != undefined) {
      for (interest of publication.related_interests) {
        if (!publication_interests.includes(interest) && interest.trim() != "")
          publication_interests.push(interest);
      }
    } else {
      console.log(
        " ! " +
          publication.slug +
          " is missing 'related_interests' in the front matter and so cannot be displayed correctly."
      );
      process.exit(1);
    }
  }

  for (author in author_publications) {
    result[author] = author_publications[author];
  }

  result.years = publication_years;
  result.interests = publication_interests;
}

module.exports = (async function () {
  await main().catch((e) => console.log(e));

  //console.log( result )

  return result;
})();

//console.log( module.exports )

/*

  publications.ordered
    [ ... publications ordered by year (most recent first) ... ]

  publications[ 'McMillion2016' ]
    { ... frontmatter from publications/McMillion2016.md ... }

  publications[ 'cefan-rubin' ]
    { ... ordered list of publications where cefan-rubin is listed as an author (most recent first) ... }

  publications[ 'years' ]
    [ 'pending', '2021', '2020', '2017', ... ]

  publications[ 'interests' ]
    [ 'privacy', 'malware', ... ]

*/
