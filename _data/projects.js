const { getFrontMatter, generateNavigationFromDirectories } = require( '../_data/functions.js' )

let { paths, lookup, flat } = generateNavigationFromDirectories( 'projects/' )

function generateProjectsData() {

  let projects = flat

  try {

    for ( const slug in flat ) {

      const file = flat[ slug ]

      const frontmatter = file.frontmatter

      // add a way to list all projects by related_profiles
      let personSlugs = frontmatter.related_profiles;
      console.log( personSlugs )
      if ( personSlugs != undefined ) {
        for ( personSlug of personSlugs ) {
          if ( typeof projects[ personSlug ] !== 'undefined' ) {
            projects[ personSlug ].push( projects[ slug ] )
          }
          else {
            projects[ personSlug ] = [ projects[ slug ] ]
          }
        }
      }

      // add a way to list all projects by related_publications
      let publicationSlugs = frontmatter.related_publications;
      if ( publicationSlugs != undefined ) {
  		for ( publicationSlug of publicationSlugs ) {
          if ( typeof projects[ publicationSlug ] !== 'undefined' ) {
  		    projects[ publicationSlug ].push( projects[ slug ] )
          }
          else {
  		    projects[ publicationSlug ] = [ projects[ slug ] ]
          }
  		}
      }

    }

  }
  catch (err) {
    console.error(err);
  }

  return projects;
}


let projects = generateProjectsData()
console.log( projects )

module.exports = projects


/*

  projects[ 'cefan-rubin' ]
    [ ... array of { name: 'Project Name from title frontmatter', path: 'file slug' } ... ]

  projects[ 'Singanamalla2021' ]
    [ ... array of { name: 'Project Name from title frontmatter', path: 'file slug' } ... ]

  projects[ 'odns' ]
    { name: "Oblivious DNS" }
    
*/
