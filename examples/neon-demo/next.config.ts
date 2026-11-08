import type {NextConfig} from 'next';
const nextConfig: NextConfig = {
    serverExternalPackages: ['@aws-sdk/client-s3'],
    poweredByHeader: false,
};
export default nextConfig;
