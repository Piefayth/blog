
const prodUrl = process.env.REACT_APP_PUBLIC_URI
const devUrl = process.env.REACT_APP_DEV_URI
const env = process.env.NODE_ENV
const url = env === 'development' ? devUrl : prodUrl

export default {
    prodUrl,
    devUrl,
    env,
    url
} 