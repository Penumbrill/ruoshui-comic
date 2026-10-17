import {useStudio} from './store';
import {translateUi} from '../shared/ui-text.mjs';
export function useUiText(){const studio=useStudio();return value=>studio.lang==='en'?translateUi(value):value;}
