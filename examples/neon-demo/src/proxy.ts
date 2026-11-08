import {auth} from '@/utils/auth';
export default auth.middleware({loginUrl: '/auth/sign-in'});
export const config = {matcher: ['/workspace/:path*']};
