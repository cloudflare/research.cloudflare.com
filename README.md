# research.cloudflare.com

- Source code for the website https://research.cloudflare.com
- Built with Docusaurus https://docusaurus.io/


## How to setup a page in the People section

1. Create a new .mdx file for the person in the src/pages/people path. I recommend copying an existing file and changing the information.
1. Make sure that your name of your json file and your mdx file are the same for consistancy.
1. The .json file is automaticaly created if you change out the name in this section:
1. import profile from '/.docusaurus/people/default/vasilis-giotsas.json'


## How to setup a new Project in the Projects section
                
1. Create a new .mdx file in the 'docusaurus/docs' path.
1. Title it with the project name.
1. Recommended to copy an existing project and delete it's contents.
1. Fill out the project details on the page.


## How to change the front page featured projects
                        
1. Locate the 'HomepageFeatures.js' file inside of src/components
1. Change the content inside of 'const FeatureList ='


----
Copyright &copy; 2021 Cloudflare
