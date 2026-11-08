import {notFound} from 'next/navigation';
import {AuthForm} from '@/components/AuthForm';
export default async function AuthPage({params}: {params: Promise<{view: string}>}) {
    const {view} = await params;
    if (!['sign-in', 'sign-up'].includes(view)) notFound();
    return <AuthForm signUp={view === 'sign-up'} />;
}
