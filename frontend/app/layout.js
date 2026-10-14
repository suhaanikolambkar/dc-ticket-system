import "./globals.css";

export const metadata = {
  title: "Distributed Railway Booking Dashboard",
  description: "Railway booking system simulation with load balancing and fault tolerance"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
