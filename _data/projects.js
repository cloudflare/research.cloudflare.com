const { getFrontMatter, generateNavigationFromDirectories } = require( '../_data/functions.js' )

let { paths, lookup, flat } = generateNavigationFromDirectories( 'projects/' )


const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )


const readdirRecursive = async ( filePath ) => {
  const dir = await fs.promises.readdir( filePath )
  const files = await Promise.all( dir.map( async relativePath => {
    const absolutePath = path.join( filePath, relativePath )
    const stat = await fs.promises.lstat( absolutePath )

    return stat.isDirectory() ? readdirRecursive(absolutePath) : absolutePath
  } ) )

  return files.flat();
}


async function generateProjectsData() {

  let projects = {};

  try {
    //const files = fs.readdirSync( 'projects/' );
    const files = await readdirRecursive( 'projects/' )

    console.log( files )

    console.log( paths )

    console.log( lookup )

    console.log( '---' )
    console.log( flat )

    let content = ''
    for ( const file of files ) {

      //console.log( file )
      //console.log( path.parse( file ) )

      if ( typeof file !== 'undefined' && path.parse( file ).ext == '.md' && path.parse( file ).name != 'index' ) {
        let slug = path.parse( file ).name
        content = fs.readFileSync( 'projects/' + file, 'utf8' )

        let front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
        //console.log( front )

        frontMatter = yaml.load( front );
        //console.log( frontMatter )

        // add an item for this slug
        projects[ slug ] = { "name": frontMatter.title, "path": slug }

        // add a way to list all projects by related_profiles
        let personSlugs = frontMatter.related_profiles;
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
        let publicationSlugs = frontMatter.related_publications;
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

  }
  catch (err) {
    console.error(err);
  }

  return projects;
}
// parse the front matter and add to 'profiles'
let projects = generateProjectsData();

module.exports = projects

console.log( 'moo' )
console.log( module.exports )
console.log( 'shoe' )

/*

  projects[ 'cefan-rubin' ]
    [ ... array of { name: 'Project Name from title frontmatter', path: 'file slug' } ... ]

  projects[ 'Singanamalla2021' ]
    [ ... array of { name: 'Project Name from title frontmatter', path: 'file slug' } ... ]

  projects[ 'odns' ]
    { name: "Oblivious DNS" }
*/
