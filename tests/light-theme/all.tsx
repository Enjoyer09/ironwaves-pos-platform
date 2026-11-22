import React from 'react';
import {createRoot} from 'react-dom/client';
import {useAppStore} from '../../src/store';
import {setClientAuthSession} from '../../src/api/client';
import MenuGrid from '../../src/components/tables/MenuGrid';
import KDS from '../../src/components/KDS';
import POS from '../../src/components/POS';
import TablesPage from '../../src/components/TablesPage';
import DashboardPanel from '../../src/components/admin/DashboardPanel';
import FinancePanel from '../../src/components/admin/FinancePanel';
import ZReportPanel from '../../src/components/admin/ZReportPanel';
import SettingsPanel from '../../src/components/admin/SettingsPanel';
import OpenTableDialog from '../../src/components/tables/OpenTableDialog';
import CreateReservationDialog from '../../src/components/tables/CreateReservationDialog';
import PaymentModal from '../../src/components/tables/PaymentModal';
import ItemActionModal from '../../src/components/tables/ItemActionModal';
import OrderNoteModal from '../../src/components/tables/OrderNoteModal';
import FullOrderListModal from '../../src/components/tables/FullOrderListModal';
import RevisionModal from '../../src/components/tables/RevisionModal';
import StatusLogModal from '../../src/components/tables/StatusLogModal';
import {Decimal} from 'decimal.js';
import '../../src/index.css';
setClientAuthSession({access_token:'synthetic-light-audit',user:{tenant_id:'audit-only'}});
useAppStore.setState({user:{id:'audit-user',username:'audit-admin',role:'admin',tenant_id:'audit-only'} as any,lang:'az',notify:()=>{}});
const view=new URLSearchParams(location.search).get('view')||'menu';
const menu=[{id:'a',item_name:'Gyros mal əti',category:'KOMBO',price:12.6},{id:'b',item_name:'Çay',category:'İÇKİ',price:2}];
const noop=()=>{};
const zero=new Decimal(0);
const breakdown={itemsTotal:new Decimal(12),discountPercent:zero,discountAmount:zero,discountedItemsTotal:new Decimal(12),serviceFee:zero,deposit:zero,finalTotal:new Decimal(12),dueNow:new Decimal(12),splitBasis:new Decimal(12),guestCount:2,depositPerGuestShare:zero};
const sampleItem={id:'item-a',item_name:'Gyros mal əti',qty:1,price:12,status:'SENT'};
const panels:Record<string,React.ReactNode>={menu:<div className="table-order-detail" style={{height:'730px',display:'flex'}}><MenuGrid items={menu} categories={['ALL','KOMBO','İÇKİ']} search="" selectedCategory="ALL" lang="az" onSearchChange={noop} onCategoryChange={noop} onSelectItem={noop}/></div>,kitchen:<KDS/>,pos:<POS/>,tables:<TablesPage/>,dashboard:<DashboardPanel onOpenTab={noop}/>,finance:<FinancePanel/>,zreport:<ZReportPanel/>,settings:<SettingsPanel/>,
openTable:<OpenTableDialog lang="az" guestCount="2" depositGuestCount="1" depositPerGuest={zero} onGuestCountChange={noop} onDepositGuestCountChange={noop} onConfirm={noop} onCancel={noop}/>,
reservation:<CreateReservationDialog lang="az" statusDraft="BOOKED" guestName="Aysel" phone="" time="18:00" partySize="2" assignedTableId="" note="" candidateTables={[]} suggestedTables={[]} onStatusDraftChange={noop} onGuestNameChange={noop} onPhoneChange={noop} onTimeChange={noop} onPartySizeChange={noop} onAssignedTableChange={noop} onNoteChange={noop} onConfirm={noop} onCancel={noop}/>,
payment:<PaymentModal lang="az" table={{id:'table-a',label:'Masa N1',guest_count:2}} breakdown={breakdown} paymentMethod="Nəğd" tableDiscountPercent="0" tableDiscountReason="" splitCash="0" splitCount="2" splitParts={[]} onPaymentMethodChange={noop} onDiscountChange={noop} onDiscountReasonChange={noop} onSplitCashChange={noop} onSplitCountChange={noop} onSplitPartsChange={noop} onSettle={noop} onCancel={noop}/>,
paymentSplit:<PaymentModal lang="az" table={{id:'table-a',label:'Masa N1',guest_count:2}} breakdown={breakdown} paymentMethod="Split" tableDiscountPercent="0" tableDiscountReason="" splitCash="0" splitCount="2" splitParts={[{amount:'6',method:'Nəğd'},{amount:'6',method:'Kart'}]} onPaymentMethodChange={noop} onDiscountChange={noop} onDiscountReasonChange={noop} onSplitCashChange={noop} onSplitCountChange={noop} onSplitPartsChange={noop} onSettle={noop} onCancel={noop}/>,
itemAction:<ItemActionModal target={{item:sampleItem,action:'void_'}} lang="az" onClose={noop} onConfirm={async()=>{}}/>,
orderNote:<OrderNoteModal itemName="Gyros mal əti" initialNote="" lang="az" tenantId="audit-only" onSave={noop} onClose={noop}/>,
sentItems:<FullOrderListModal lang="az" tableLabel="Masa N1" items={[sampleItem]} tableNeedsSafeCancel={false} isManagerUser userCanEditTable onClose={noop} onVoidItem={noop} onCancelTable={noop}/>,
revision:<RevisionModal target={{tableId:'table-a',itemName:'Gyros mal əti',nextItems:[],hasSentItems:true}} lang="az" onClose={noop} onConfirm={async()=>{}}/>,
statusLog:<StatusLogModal target={{item_name:'Gyros mal əti'}} rows={[]} lang="az" onClose={noop}/>};
// Additional conditional states that are hidden on the initial screens.
panels.paymentDiscount=<PaymentModal lang="az" table={{id:'table-a',label:'Masa N1',guest_count:2}} breakdown={{...breakdown,discountPercent:new Decimal(10),discountAmount:new Decimal('1.20'),discountedItemsTotal:new Decimal('10.80'),finalTotal:new Decimal('10.80'),dueNow:new Decimal('10.80'),splitBasis:new Decimal('10.80')}} paymentMethod="Kart" tableDiscountPercent="10" tableDiscountReason="Audit" splitCash="0" splitCount="2" splitParts={[]} onPaymentMethodChange={noop} onDiscountChange={noop} onDiscountReasonChange={noop} onSplitCashChange={noop} onSplitCountChange={noop} onSplitPartsChange={noop} onSettle={noop} onCancel={noop}/>;
panels.itemActionDraft=<ItemActionModal target={{item:{...sampleItem,status:'DRAFT'},action:'void_'}} lang="az" onClose={noop} onConfirm={async()=>{}}/>;
createRoot(document.getElementById('root')!).render(<div style={{height:'100vh'}}>{panels[view]}</div>);
