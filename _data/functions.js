const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )


function getFrontMatter( path ) {

  const content = fs.readFileSync( path, 'utf8' )
  const front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
  frontMatter = yaml.load( front )
  
  return frontMatter	
}



function generateNavigationFromDirectories( root, paths = [], lookup = {}, flat = {} ) {

  const dirents = fs.readdirSync( './' + root, { withFileTypes: true } )
      
  for ( const dirent of dirents ) {

    //console.log( dirent )

    // skip non-structural pages
    if ( dirent.name.includes( '.js' ) || dirent.name.includes( '.json' ) 
      || dirent.name == 'index.njk' || dirent.name[0] == '_' ) {
      continue
    }
          
    if ( dirent.isDirectory() ) {

      const directory = dirent.name
      const frontMatter = getFrontMatter( root + directory + '/index.njk' )
      const children = generateNavigationFromDirectories( root + directory + '/', [], lookup, flat )
      paths.push( { 
        path: '/' + root + directory + '/', 
        label: frontMatter.title, 
        children: children.paths
      } )
      lookup[ '/' + root + directory + '/' ] = children.paths

    }  
    else {
      const file = dirent.name
      const slug = path.parse( file ).name
      const frontMatter = getFrontMatter( root + file )
      if ( frontMatter ) {
        paths.push( {
          path: '/' + root + slug + '/', 
    	  label: frontMatter.title,
          children: []
        } )
        lookup[ '/' + root + file ] = frontMatter.title
        flat[ slug ] = { "name": frontMatter.title, "path": root + slug, "frontmatter": frontMatter }
      }
      else {
      	throw new Error( `${root}${file} has no front matter?` )
      }
    }
  }
        
  return { paths, lookup, flat }
}


module.exports = {
  getFrontMatter,
  generateNavigationFromDirectories
}
