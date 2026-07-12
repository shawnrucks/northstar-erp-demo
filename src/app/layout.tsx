import type {Metadata} from "next"; import "./globals.css";
export const metadata:Metadata={title:"Northstar Industrial Components",description:"Precision manufacturing and operations ERP demo."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
