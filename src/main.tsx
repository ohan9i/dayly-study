import React from 'react';
import ReactDOM from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import App from './App';
import './fonts.css';
import './tailwind.css';
import './styles.css';
import './studio.css';
import './components/ui/button.css';
import './planner-ui.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
