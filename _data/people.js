const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )

function processProfileDir( dir ) {

  let profiles = []

  try {
    const files = fs.readdirSync( dir );

    let content = ''
    for ( const file of files ) {

      //console.log( file )
      //console.log( path.parse( file ) )

      if ( typeof file !== 'undefined' && path.parse( file ).ext == '.md' ) {
        let slug = path.parse( file ).name
        content = fs.readFileSync( dir + '/' + file, 'utf8' )

        let front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
        //console.log( front )

        frontMatter = yaml.load( front );
        //console.log( frontMatter )

        // try to avoid duplicates
        if ( profiles[ slug ] ) {
					throw( "profile for '" + slug + "' already processed. Duplicate profile at '" + dir + '/' + slug + ".md'" )
        }

        if ( frontMatter.position ) {
          frontMatter.slug = slug
          frontMatter.path = dir + '/' + slug
          profiles.push( frontMatter )
        }

      }
    }

    return profiles

  }
  catch (err) {
    console.error(err);
  }

}

// handle employee, researcher and intern profiles
let employees = processProfileDir( 'people' )
let researchers = processProfileDir( 'outreach/academic-programs/researchers' )
let interns = processProfileDir( 'outreach/academic-programs/interns' )

module.exports = {
  employees : employees.map( (element) => element.slug ),
  researchers : researchers.map( (element) => element.slug ),
  interns : interns.map( (element) => element.slug )
}

let all_profiles = []
all_profiles = all_profiles.concat( employees ).concat( researchers ).concat( interns )

for ( profile of all_profiles ) {
  module.exports[ profile.slug ] = profile
}

console.log( module.exports )

/*

  people.employees
    [ ... alphabetical array of employee profiles ... ]

  people.interns
    [ ... alphabetical array of intern profiles ... ]

  people[ 'cefan-rubin' ]
    { ... frontmatter from people/cefan-rubin.md ... }

*/
