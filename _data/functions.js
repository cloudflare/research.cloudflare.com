const fs = require( 'fs' )
const path = require( 'path' )

const yaml = require( 'js-yaml' )


function getFrontMatter( path ) {

  const content = fs.readFileSync( path, 'utf8' )
  const front= content.substr( 4, content.indexOf( '---', 4 ) - 4 )
  frontMatter = yaml.load( front )
  
  return frontMatter	
}



function generateNavigationFromDirectories( root, paths = [], lookup = {} ) {

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
      const children = generateNavigationFromDirectories( root + directory + '/' )
      paths.push( { 
        path: '/' + root + directory + '/', 
        label: frontMatter.title, 
        children: children.paths
      } )
      lookup[ '/' + root + directory + '/' ] = children.paths

    }  
    else {

      const file = dirent.name
      const frontMatter = getFrontMatter( root + file )
      paths.push( {
        path: '/' + root + path.parse( file ).name + '/', 
    	label: frontMatter.title,
        children: []
      } )
      lookup[ '/' + root + file ] = frontMatter.title
    }
  }
        
  return { paths, lookup }
}


module.exports = {
  getFrontMatter,
  generateNavigationFromDirectories
}
