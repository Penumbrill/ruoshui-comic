// External processes cannot read Electron's virtual ASAR filesystem.
export function externalResource(filename){
 return filename.replace(/([\\/])app\.asar(?=[\\/]|$)/,'$1app.asar.unpacked');
}
