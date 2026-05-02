import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders trustflow header", () => {
  render(<App />);
  expect(screen.getByText(/trustflow/i)).toBeInTheDocument();
  expect(
    screen.getByText(/milestone escrow for clients, freelancers, and arbiters/i)
  ).toBeInTheDocument();
});
