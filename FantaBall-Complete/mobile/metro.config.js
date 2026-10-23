const {getDefaultConfig}=require('expo/metro-config');const c=getDefaultConfig(__dirname);if(!c.resolver.assetExts.includes('html'))c.resolver.assetExts.push('html');module.exports=c;
