import Taro, { useLaunch } from '@tarojs/taro'
import './app.scss'

interface AppProps {
  children: React.ReactNode;
}

function App({ children }: AppProps) {
  useLaunch(() => {
    console.log('App launched.')
  })

  return children
}

export default App
