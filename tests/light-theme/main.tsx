import React from 'react';
import {createRoot} from 'react-dom/client';
import MenuGrid from '../../src/components/tables/MenuGrid';
import '../../src/index.css';
const items=[{id:'a',item_name:'Gyros mal əti',category:'KOMBO',price:12.6},{id:'b',item_name:'Çay',category:'İÇKİ',price:2}];
createRoot(document.getElementById('root')!).render(<div className="table-order-detail" style={{height:'740px',display:'flex'}}><MenuGrid items={items} categories={['ALL','KOMBO','İÇKİ']} search="" selectedCategory="ALL" lang="az" onSearchChange={()=>{}} onCategoryChange={()=>{}} onSelectItem={()=>{}}/></div>);
