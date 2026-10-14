import React from "react";
import { useNavigate } from "@/lib/next-router";
import Layout from "@/components/layout/Layout";

const Unauthorized: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="container-fluid py-4">
        <div className="row justify-content-center">
          <div className="col-md-6">
            <div className="card border-danger">
              <div className="card-header bg-danger text-white">
                <h4 className="mb-0">
                  <i className="bi bi-shield-exclamation me-2"></i>
                  Access Denied
                </h4>
              </div>
              <div className="card-body text-center py-5">
                <i className="bi bi-lock-fill text-danger" style={{ fontSize: "4rem" }}></i>
                <h3 className="mt-3">Unauthorized Access</h3>
                <p className="text-muted">
                  You don&apos;t have permission to access this page. Please contact your administrator if you believe this is an error.
                </p>
                <div className="mt-4">
                  <button
                    className="btn btn-primary me-2"
                    onClick={() => navigate(-1)}
                  >
                    <i className="bi bi-arrow-left me-2"></i>
                    Go Back
                  </button>
                  <button
                    className="btn btn-outline-primary"
                    onClick={() => navigate("/requests/pending")}
                  >
                    <i className="bi bi-house me-2"></i>
                    Staff Dashboard
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Unauthorized;
