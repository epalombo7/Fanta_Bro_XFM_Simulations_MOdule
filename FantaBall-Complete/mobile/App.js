import React,{useEffect,useState} from 'react';
import {SafeAreaView,Text,StatusBar,useColorScheme,ActivityIndicator} from 'react-native';
import {Asset} from 'expo-asset';
import * as FS from 'expo-file-system/legacy';
import {WebView} from 'react-native-webview';
export default function App(){const [html,setHtml]=useState(null),[error,setError]=useState(''),dark=useColorScheme()==='dark';useEffect(()=>{(async()=>{try{let a=Asset.fromModule(require('./assets/webview.html'));await a.downloadAsync();setHtml(await FS.readAsStringAsync(a.localUri))}catch(e){setError(e.message)}})()},[]);return <SafeAreaView style={{flex:1,backgroundColor:dark?'#10171b':'#f5f6f8'}}><StatusBar barStyle={dark?'light-content':'dark-content'}/>{error?<Text>{error}</Text>:html?<WebView source={{html,baseUrl:'https://fantaball.local'}} domStorageEnabled javaScriptEnabled/>:<ActivityIndicator/>}</SafeAreaView>}
